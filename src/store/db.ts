import { DatabaseSync } from 'node:sqlite';

export function createDatabase(dbPath = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(dbPath);

  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
  }

  initSchema(db);
  return db;
}

export function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      reserved_by TEXT,
      reserved_at INTEGER,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      phone_number TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      claimed_by TEXT,
      claimed_at INTEGER,
      retry_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      agent_id TEXT,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      provider_call_id TEXT,
      initiated_at INTEGER,
      answered_at INTEGER,
      connected_at INTEGER,
      completed_at INTEGER,
      failed_reason TEXT,
      last_applied_seq INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (lead_id) REFERENCES leads(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
  `);
}