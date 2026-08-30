import { DatabaseSync } from 'node:sqlite';
import { ProviderEvent, mapEventToCallState } from '../domain/events.js';
import { CallRepository } from '../store/callRepo.js';
import { AgentRepository } from '../store/agentRepo.js';

export interface IngestionResult {
  accepted: boolean;
  reason?: 'DUPLICATE' | 'OUT_OF_ORDER' | 'INVALID_TRANSITION' | 'CALL_NOT_FOUND' | 'APPLIED' | 'DB_CLOSED';
}

export class ProviderEventBus {
  private callRepo: CallRepository;
  private agentRepo: AgentRepository;

  constructor(private db: DatabaseSync) {
    this.callRepo = new CallRepository(db);
    this.agentRepo = new AgentRepository(db);
    this.initSchema();
  }

  private initSchema(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS processed_events (
          event_id TEXT PRIMARY KEY,
          call_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          received_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_processed_call ON processed_events(call_id);
      `);
    } catch {
      // Ignored if DB is closed
    }
  }

  processEvent(event: ProviderEvent): IngestionResult {
    // 1. Idempotency Check
    try {
      const now = Date.now();
      const insertStmt = this.db.prepare(`
        INSERT OR IGNORE INTO processed_events (event_id, call_id, seq, received_at)
        VALUES (?, ?, ?, ?)
      `);
      const insertRes = insertStmt.run(event.eventId, event.callId, event.sequenceNumber, now) as any;
      if (insertRes.changes === 0) {
        return { accepted: false, reason: 'DUPLICATE' };
      }

      // 2. Fetch current call
      const call = this.callRepo.getCallById(event.callId);
      if (!call) {
        return { accepted: false, reason: 'CALL_NOT_FOUND' };
      }

      // 3. Monotonic Sequence Ordering Check
      if (event.sequenceNumber <= call.lastAppliedSeq) {
        return { accepted: false, reason: 'OUT_OF_ORDER' };
      }

      // 4. Map Provider Event to Target Call State
      const nextCallState = mapEventToCallState(event.type);

      // 5. Attempt atomic transition
      const transition = this.callRepo.transitionCall(
        call.id,
        call.version,
        nextCallState,
        {
          providerCallId: event.providerCallId,
          seq: event.sequenceNumber,
          failedReason: event.metadata?.disconnectReason,
        }
      );

      if (!transition.success) {
        return { accepted: false, reason: 'INVALID_TRANSITION' };
      }

      // 6. Handle Agent State Transitions
      if (call.agentId) {
        const agent = this.agentRepo.getAgentById(call.agentId);
        if (agent) {
          if (nextCallState === 'INITIATED' && agent.status === 'RESERVED') {
            this.agentRepo.transitionStatus(agent.id, agent.version, 'DIALING');
          } else if (nextCallState === 'CONNECTED' && agent.status === 'DIALING') {
            this.agentRepo.transitionStatus(agent.id, agent.version, 'CONNECTED');
          } else if (
            (nextCallState === 'COMPLETED' || nextCallState === 'FAILED') &&
            (agent.status === 'DIALING' || agent.status === 'CONNECTED' || agent.status === 'RESERVED')
          ) {
            this.agentRepo.transitionStatus(agent.id, agent.version, 'AVAILABLE');
          }
        }
      }

      return { accepted: true, reason: 'APPLIED' };
    } catch (err: any) {
      if (err?.code === 'ERR_INVALID_STATE') {
        return { accepted: false, reason: 'DB_CLOSED' };
      }
      throw err;
    }
  }
}