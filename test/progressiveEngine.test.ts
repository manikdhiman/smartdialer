import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../src/store/db.js';
import { AgentRepository } from '../src/store/agentRepo.js';
import { LeadRepository } from '../src/store/leadRepo.js';
import { CallRepository } from '../src/store/callRepo.js';
import { ProgressiveEngine } from '../src/engine/ProgressiveEngine.js';
import { CallAllocator } from '../src/engine/CallAllocator.js';
import { ProviderA } from '../src/providers/ProviderA.js';
import { ProviderEventBus } from '../src/providers/ProviderEventBus.js';

describe('Progressive Engine & Call Allocator End-to-End', () => {
  let db: DatabaseSync;
  let agentRepo: AgentRepository;
  let leadRepo: LeadRepository;
  let callRepo: CallRepository;
  let providerA: ProviderA;
  let eventBus: ProviderEventBus;
  let allocator: CallAllocator;
  let progressiveEngine: ProgressiveEngine;

  beforeEach(() => {
    db = createDatabase(':memory:');
    agentRepo = new AgentRepository(db);
    leadRepo = new LeadRepository(db);
    callRepo = new CallRepository(db);
    providerA = new ProviderA({ minSetupMs: 10, maxSetupMs: 20, failureRate: 0 });
    eventBus = new ProviderEventBus(db);
    allocator = new CallAllocator(db, providerA, eventBus);
    progressiveEngine = new ProgressiveEngine();

    // Populate 3 available agents
    agentRepo.insertAgent({ id: 'agent-1', name: 'Agent 1', status: 'AVAILABLE' });
    agentRepo.insertAgent({ id: 'agent-2', name: 'Agent 2', status: 'AVAILABLE' });
    agentRepo.insertAgent({ id: 'agent-3', name: 'Agent 3', status: 'AVAILABLE' });

    // Populate 5 leads
    for (let i = 1; i <= 5; i++) {
      leadRepo.insertLead(`lead-${i}`, `+1555000${i}`);
    }
  });

  afterEach(() => {
    db.close();
  });

  it('ProgressiveEngine strictly proposes min(availableAgents - inFlight, capacity)', () => {
    const proposal1 = progressiveEngine.propose({
      availableAgents: 3,
      activeAgents: 0,
      totalAgents: 3,
      ringingCalls: 0,
      dialingCalls: 0,
      connectedCalls: 0,
      rollingAnswerRate: 0.5,
      avgTalkTimeSeconds: 60,
      avgSetupTimeSeconds: 5,
    });

    expect(proposal1.proposedCalls).toBe(3);

    // If 1 call is already dialing and 1 ringing, capacity is 3 - 2 = 1
    const proposal2 = progressiveEngine.propose({
      availableAgents: 3,
      activeAgents: 0,
      totalAgents: 3,
      ringingCalls: 1,
      dialingCalls: 1,
      connectedCalls: 0,
      rollingAnswerRate: 0.5,
      avgTalkTimeSeconds: 60,
      avgSetupTimeSeconds: 5,
    });

    expect(proposal2.proposedCalls).toBe(1);
  });

  it('CallAllocator successfully allocates exactly approved count and progresses call states via Provider A', async () => {
    const proposal = progressiveEngine.propose({
      availableAgents: agentRepo.countAvailableAgents(),
      activeAgents: 0,
      totalAgents: 3,
      ringingCalls: 0,
      dialingCalls: 0,
      connectedCalls: 0,
      rollingAnswerRate: 1.0,
      avgTalkTimeSeconds: 60,
      avgSetupTimeSeconds: 5,
    });

    expect(proposal.proposedCalls).toBe(3);

    // Run allocation for the 3 proposed calls
    const allocResult = await allocator.allocateCalls(proposal.proposedCalls, 'worker-main');

    expect(allocResult.successful).toBe(3);
    expect(allocResult.allocatedCalls.length).toBe(3);

    // Verify agents are now RESERVED or DIALING
    const availableAfter = agentRepo.countAvailableAgents();
    expect(availableAfter).toBe(0);

    // Wait for provider A async event lifecycle (INITIATED -> RINGING -> ANSWERED -> CONNECTED)
    await new Promise((resolve) => setTimeout(resolve, 80));

    // Confirm that calls and agents reached CONNECTED status through the event pipeline
    for (const alloc of allocResult.allocatedCalls) {
      const call = callRepo.getCallById(alloc.callId)!;
      const agent = agentRepo.getAgentById(alloc.agentId)!;

      expect(call.status).toBe('CONNECTED');
      expect(agent.status).toBe('CONNECTED');
    }
  });
});