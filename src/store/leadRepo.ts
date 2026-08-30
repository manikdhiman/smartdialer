import { DatabaseSync } from 'node:sqlite';

export interface Lead {
  id: string;
  phoneNumber: string;
  status: 'QUEUED' | 'CLAIMED' | 'PROCESSED' | 'FAILED';
  version: number;
  claimedBy: string | null;
  claimedAt: number | null;
  retryCount: number;
  updatedAt: number;
}

export class LeadRepository {
  constructor(private db: DatabaseSync) {}

  insertLead(id: string, phoneNumber: string): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO leads (id, phone_number, status, version, retry_count, updated_at)
      VALUES (?, ?, 'QUEUED', 1, 0, ?)
    `).run(id, phoneNumber, now);
  }

  getQueuedLeads(limit = 50): Lead[] {
    const stmt = this.db.prepare(`
      SELECT * FROM leads WHERE status = 'QUEUED' ORDER BY retry_count ASC, rowid ASC LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];
    return rows.map(r => this.mapRow(r));
  }

  claimLead(leadId: string, expectedVersion: number, workerId: string): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE leads
      SET status = 'CLAIMED',
          version = version + 1,
          claimed_by = ?,
          claimed_at = ?,
          updated_at = ?
      WHERE id = ? AND status = 'QUEUED' AND version = ?
    `);
    const result = stmt.run(workerId, now, now, leadId, expectedVersion) as any;
    return result.changes === 1;
  }

  markProcessed(leadId: string): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE leads
      SET status = 'PROCESSED', version = version + 1, updated_at = ?
      WHERE id = ?
    `).run(now, leadId);
  }

  reapStaleClaims(ttlMs: number): number {
    const cutoff = Date.now() - ttlMs;
    const stmt = this.db.prepare(`
      UPDATE leads
      SET status = 'QUEUED',
          version = version + 1,
          claimed_by = NULL,
          claimed_at = NULL,
          updated_at = ?
      WHERE status = 'CLAIMED' AND claimed_at < ?
    `);
    const result = stmt.run(Date.now(), cutoff) as any;
    return Number(result.changes);
  }

  private mapRow(r: any): Lead {
    return {
      id: String(r.id),
      phoneNumber: String(r.phone_number),
      status: r.status,
      version: Number(r.version),
      claimedBy: r.claimed_by ? String(r.claimed_by) : null,
      claimedAt: r.claimed_at ? Number(r.claimed_at) : null,
      retryCount: Number(r.retry_count),
      updatedAt: Number(r.updated_at),
    };
  }
}