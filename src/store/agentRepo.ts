import { DatabaseSync } from 'node:sqlite';
import { Agent, AgentState, validateAgentTransition } from '../domain/agent.js';

export class AgentRepository {
  constructor(private db: DatabaseSync) {}

  insertAgent(agent: Omit<Agent, 'version' | 'updatedAt' | 'reservedByWorkerId' | 'reservedAt'>): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO agents (id, name, status, version, reserved_by, reserved_at, updated_at)
      VALUES (?, ?, ?, 1, NULL, NULL, ?)
    `);
    stmt.run(agent.id, agent.name, agent.status, now);
  }

  getAgentById(id: string): Agent | null {
    const stmt = this.db.prepare('SELECT * FROM agents WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.mapRowToAgent(row);
  }

  getAvailableAgents(): Agent[] {
    const stmt = this.db.prepare("SELECT * FROM agents WHERE status = 'AVAILABLE'");
    const rows = stmt.all() as any[];
    return rows.map((r) => this.mapRowToAgent(r));
  }

  countAvailableAgents(): number {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'AVAILABLE'");
    const row = stmt.get() as any;
    return Number(row.count);
  }

  reserveAgent(agentId: string, expectedVersion: number, workerId: string): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE agents
      SET status = 'RESERVED',
          version = version + 1,
          reserved_by = ?,
          reserved_at = ?,
          updated_at = ?
      WHERE id = ? AND status = 'AVAILABLE' AND version = ?
    `);

    const result = stmt.run(workerId, now, now, agentId, expectedVersion) as any;
    return result.changes === 1;
  }

  transitionStatus(agentId: string, expectedVersion: number, nextStatus: AgentState): boolean {
    const current = this.getAgentById(agentId);
    if (!current) return false;

    const validation = validateAgentTransition(current.status, nextStatus);
    if (!validation.success) {
      return false;
    }

    const now = Date.now();
    const clearReservation = nextStatus === 'AVAILABLE' || nextStatus === 'OFFLINE';

    const stmt = this.db.prepare(`
      UPDATE agents
      SET status = ?,
          version = version + 1,
          reserved_by = CASE WHEN ? = 1 THEN NULL ELSE reserved_by END,
          reserved_at = CASE WHEN ? = 1 THEN NULL ELSE reserved_at END,
          updated_at = ?
      WHERE id = ? AND version = ?
    `);

    const result = stmt.run(nextStatus, clearReservation ? 1 : 0, clearReservation ? 1 : 0, now, agentId, expectedVersion) as any;
    return result.changes === 1;
  }

  reapStaleReservations(ttlMs: number): number {
    const cutoff = Date.now() - ttlMs;
    const stmt = this.db.prepare(`
      UPDATE agents
      SET status = 'AVAILABLE',
          version = version + 1,
          reserved_by = NULL,
          reserved_at = NULL,
          updated_at = ?
      WHERE status = 'RESERVED' AND reserved_at < ?
    `);
    const result = stmt.run(Date.now(), cutoff) as any;
    return Number(result.changes);
  }

  private mapRowToAgent(row: any): Agent {
    return {
      id: String(row.id),
      name: String(row.name),
      status: row.status as AgentState,
      version: Number(row.version),
      reservedByWorkerId: row.reserved_by ? String(row.reserved_by) : null,
      reservedAt: row.reserved_at ? Number(row.reserved_at) : null,
      updatedAt: Number(row.updated_at),
    };
  }
}