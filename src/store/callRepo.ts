import { DatabaseSync } from 'node:sqlite';
import { Call, CallState, validateCallTransition } from '../domain/call.js';

export class CallRepository {
  constructor(private db: DatabaseSync) {}

  createCall(callId: string, leadId: string, agentId: string | null = null): Call {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO calls (id, lead_id, agent_id, status, version, last_applied_seq, updated_at)
      VALUES (?, ?, ?, 'QUEUED', 1, 0, ?)
    `).run(callId, leadId, agentId, now);

    return this.getCallById(callId)!;
  }

  getCallById(id: string): Call | null {
    const stmt = this.db.prepare('SELECT * FROM calls WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  transitionCall(
    callId: string,
    expectedVersion: number,
    nextStatus: CallState,
    meta?: { providerCallId?: string; seq?: number; failedReason?: string }
  ): { success: boolean; call?: Call; reason?: string } {
    const current = this.getCallById(callId);
    if (!current) return { success: false, reason: 'Call not found' };

    const validation = validateCallTransition(current.status, nextStatus);
    if (!validation.success) {
      return { success: false, reason: validation.reason };
    }

    const now = Date.now();
    const initiatedAt = nextStatus === 'INITIATED' ? now : current.initiatedAt;
    const answeredAt = nextStatus === 'ANSWERED' ? now : current.answeredAt;
    const connectedAt = nextStatus === 'CONNECTED' ? now : current.connectedAt;
    const completedAt = nextStatus === 'COMPLETED' ? now : current.completedAt;

    const stmt = this.db.prepare(`
      UPDATE calls
      SET status = ?,
          version = version + 1,
          provider_call_id = COALESCE(?, provider_call_id),
          last_applied_seq = MAX(last_applied_seq, ?),
          initiated_at = ?,
          answered_at = ?,
          connected_at = ?,
          completed_at = ?,
          failed_reason = COALESCE(?, failed_reason),
          updated_at = ?
      WHERE id = ? AND version = ?
    `);

    const result = stmt.run(
      nextStatus,
      meta?.providerCallId ?? null,
      meta?.seq ?? current.lastAppliedSeq,
      initiatedAt,
      answeredAt,
      connectedAt,
      completedAt,
      meta?.failedReason ?? null,
      now,
      callId,
      expectedVersion
    ) as any;

    if (result.changes === 0) {
      return { success: false, reason: 'CAS version conflict' };
    }

    return { success: true, call: this.getCallById(callId)! };
  }

  private mapRow(r: any): Call {
    return {
      id: String(r.id),
      leadId: String(r.lead_id),
      agentId: r.agent_id ? String(r.agent_id) : null,
      status: r.status as CallState,
      version: Number(r.version),
      providerCallId: r.provider_call_id ? String(r.provider_call_id) : null,
      initiatedAt: r.initiated_at ? Number(r.initiated_at) : null,
      answeredAt: r.answered_at ? Number(r.answered_at) : null,
      connectedAt: r.connected_at ? Number(r.connected_at) : null,
      completedAt: r.completed_at ? Number(r.completed_at) : null,
      failedReason: r.failed_reason ? String(r.failed_reason) : null,
      lastAppliedSeq: Number(r.last_applied_seq),
      updatedAt: Number(r.updated_at),
    };
  }
}