import { DatabaseSync } from 'node:sqlite';
import { LeadRepository } from '../store/leadRepo.js';
import { AgentRepository } from '../store/agentRepo.js';
import { CallRepository } from '../store/callRepo.js';
import { TelecomProvider } from '../providers/TelecomProvider.js';
import { ProviderEventBus } from '../providers/ProviderEventBus.js';
import { randomUUID } from 'node:crypto';

export interface AllocationResult {
  attempted: number;
  successful: number;
  allocatedCalls: Array<{ callId: string; leadId: string; agentId: string }>;
  failedAllocations: Array<{ leadId?: string; reason: string }>;
}

export class CallAllocator {
  private leadRepo: LeadRepository;
  private agentRepo: AgentRepository;
  private callRepo: CallRepository;
  private eventBus: ProviderEventBus;

  constructor(
    private db: DatabaseSync,
    private provider: TelecomProvider,
    eventBus?: ProviderEventBus
  ) {
    this.leadRepo = new LeadRepository(db);
    this.agentRepo = new AgentRepository(db);
    this.callRepo = new CallRepository(db);
    this.eventBus = eventBus ?? new ProviderEventBus(db);

    // Bind provider event emissions directly to our idempotency ingestion bus
    this.provider.onEvent((evt) => {
      this.eventBus.processEvent(evt);
    });
  }

  /**
   * Allocates up to `count` outbound calls by atomically matching QUEUED leads
   * to AVAILABLE agents via CAS.
   */
  async allocateCalls(count: number, workerId: string): Promise<AllocationResult> {
    const result: AllocationResult = {
      attempted: count,
      successful: 0,
      allocatedCalls: [],
      failedAllocations: [],
    };

    if (count <= 0) return result;

    const queuedLeads = this.leadRepo.getQueuedLeads(count);
    const availableAgents = this.agentRepo.getAvailableAgents();

    const maxPairs = Math.min(count, queuedLeads.length, availableAgents.length);

    for (let i = 0; i < maxPairs; i++) {
      const lead = queuedLeads[i];
      const agent = availableAgents[i];

      // 1. Atomic CAS lead claim
      const leadClaimed = this.leadRepo.claimLead(lead.id, lead.version, workerId);
      if (!leadClaimed) {
        result.failedAllocations.push({ leadId: lead.id, reason: 'LEAD_CAS_CONFLICT' });
        continue;
      }

      // 2. Atomic CAS agent reservation
      const agentReserved = this.agentRepo.reserveAgent(agent.id, agent.version, workerId);
      if (!agentReserved) {
        // Rollback lead claim
        this.leadRepo.reapStaleClaims(0);
        result.failedAllocations.push({ leadId: lead.id, reason: 'AGENT_CAS_CONFLICT' });
        continue;
      }

      // 3. Create call record
      const callId = `call_${randomUUID()}`;
      this.callRepo.createCall(callId, lead.id, agent.id);
      const call = this.callRepo.getCallById(callId)!;

      // 4. Transition Call QUEUED -> RESERVED
      this.callRepo.transitionCall(call.id, call.version, 'RESERVED');
      const reservedCall = this.callRepo.getCallById(call.id)!;

      // 5. Dispatch call to provider
      try {
        const { providerCallId } = await this.provider.placeCall(callId, lead.phoneNumber);

        result.successful++;
        result.allocatedCalls.push({ callId, leadId: lead.id, agentId: agent.id });
      } catch (err: any) {
        // Rollback on dispatch failure
        this.callRepo.transitionCall(reservedCall.id, reservedCall.version, 'FAILED', {
          failedReason: err?.message ?? 'PROVIDER_DISPATCH_ERROR',
        });
        const currentAgent = this.agentRepo.getAgentById(agent.id);
        if (currentAgent) {
          this.agentRepo.transitionStatus(currentAgent.id, currentAgent.version, 'AVAILABLE');
        }
        result.failedAllocations.push({ leadId: lead.id, reason: 'DISPATCH_ERROR' });
      }
    }

    return result;
  }
}