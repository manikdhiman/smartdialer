import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../src/store/db.js';
import { AgentRepository } from '../src/store/agentRepo.js';
import { DatabaseSync } from 'node:sqlite';

describe('Concurrency & CAS Race Conditions', () => {
  let db: DatabaseSync;
  let agentRepo: AgentRepository;

  beforeEach(() => {
    db = createDatabase(':memory:');
    agentRepo = new AgentRepository(db);

    agentRepo.insertAgent({
      id: 'agent-101',
      name: 'Alice',
      status: 'AVAILABLE',
    });
  });

  afterEach(() => {
    db.close();
  });

  it('proves exactly ONE worker wins the race when 5 workers target the same agent simultaneously', async () => {
    const agent = agentRepo.getAgentById('agent-101')!;
    expect(agent.status).toBe('AVAILABLE');
    expect(agent.version).toBe(1);

    const workers = ['worker-A', 'worker-B', 'worker-C', 'worker-D', 'worker-E'];

    const results = await Promise.all(
      workers.map(async (workerId) => {
        return {
          workerId,
          won: agentRepo.reserveAgent('agent-101', agent.version, workerId),
        };
      })
    );

    const winners = results.filter((r) => r.won);
    const losers = results.filter((r) => !r.won);

    expect(winners.length).toBe(1);
    expect(losers.length).toBe(4);

    const updatedAgent = agentRepo.getAgentById('agent-101')!;
    expect(updatedAgent.status).toBe('RESERVED');
    expect(updatedAgent.version).toBe(2);
    expect(updatedAgent.reservedByWorkerId).toBe(winners[0].workerId);
  });

  it('reaper releases stuck reservations after TTL expiration', async () => {
    const agent = agentRepo.getAgentById('agent-101')!;
    agentRepo.reserveAgent('agent-101', agent.version, 'crashed-worker');

    await new Promise((resolve) => setTimeout(resolve, 25));

    const reapedCount = agentRepo.reapStaleReservations(20);
    expect(reapedCount).toBe(1);

    const reapedAgent = agentRepo.getAgentById('agent-101')!;
    expect(reapedAgent.status).toBe('AVAILABLE');
    expect(reapedAgent.reservedByWorkerId).toBeNull();
  });
});