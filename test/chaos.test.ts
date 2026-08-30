import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../src/store/db.js';
import { AgentRepository } from '../src/store/agentRepo.js';
import { LeadRepository } from '../src/store/leadRepo.js';
import { CallRepository } from '../src/store/callRepo.js';
import { DialerWorker } from '../src/worker.js';
import { ProviderA } from '../src/providers/ProviderA.js';
import { ProviderB } from '../src/providers/ProviderB.js';
import { ProviderHealthMonitor } from '../src/providers/HealthMonitor.js';

describe('Chaos & Failure Scenarios (§11 Spec)', () => {
  let db: DatabaseSync;
  let agentRepo: AgentRepository;
  let leadRepo: LeadRepository;
  let callRepo: CallRepository;

  beforeEach(() => {
    db = createDatabase(':memory:');
    agentRepo = new AgentRepository(db);
    leadRepo = new LeadRepository(db);
    callRepo = new CallRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('Scenario 1: Worker crash right after Call INITIATED releases agent & lead via TTL reaper', async () => {
    agentRepo.insertAgent({ id: 'agent-crash-1', name: 'Agent Crash', status: 'AVAILABLE' });
    leadRepo.insertLead('lead-crash-1', '+15559991');

    // Simulate worker reserving agent and lead, then crashing
    agentRepo.reserveAgent('agent-crash-1', 1, 'worker-crashed');
    leadRepo.claimLead('lead-crash-1', 1, 'worker-crashed');

    // Verify both are locked
    expect(agentRepo.countAvailableAgents()).toBe(0);

    // Wait for TTL (e.g. 20ms)
    await new Promise((r) => setTimeout(r, 30));

    // Maintenance reaper runs
    const reapedAgents = agentRepo.reapStaleReservations(20);
    const reapedLeads = leadRepo.reapStaleClaims(20);

    expect(reapedAgents).toBe(1);
    expect(reapedLeads).toBe(1);
    expect(agentRepo.getAgentById('agent-crash-1')!.status).toBe('AVAILABLE');
    expect(leadRepo.getQueuedLeads().length).toBe(1);
  });

  it('Scenario 2: Provider outage triggers health monitor circuit breaker', () => {
    const healthMonitor = new ProviderHealthMonitor();

    // 6 failures in a row (100% failure rate)
    for (let i = 0; i < 6; i++) {
      healthMonitor.recordAttempt(false);
    }

    const status = healthMonitor.getStatus();
    expect(status.isHealthy).toBe(false);
    expect(status.failureRate).toBe(1.0);
  });

  it('Scenario 3: Mass agent drop (100 -> 40) immediately shrinks Safety Controller ceiling', async () => {
    for (let i = 1; i <= 100; i++) {
      agentRepo.insertAgent({ id: `ag-${i}`, name: `Agent ${i}`, status: 'AVAILABLE' });
      leadRepo.insertLead(`lead-${i}`, `+1555${i}`);
    }

    const worker = new DialerWorker({
      workerId: 'worker-scale',
      db,
      mode: 'PREDICTIVE',
      provider: new ProviderA({ minSetupMs: 1, maxSetupMs: 2, failureRate: 0 }),
    });

    // 60 agents disconnect abruptly
    for (let i = 1; i <= 60; i++) {
      const agent = agentRepo.getAgentById(`ag-${i}`)!;
      agentRepo.transitionStatus(agent.id, agent.version, 'OFFLINE');
    }

    expect(agentRepo.countAvailableAgents()).toBe(40);

    // Next tick recomputes availableAgents to 40 and caps dialing accordingly
    const tickResult = await worker.runTick();
    expect(tickResult.availableAgents).toBe(40);
    expect(tickResult.allocated).toBeLessThanOrEqual(41); // 40 + smallBuffer (1)
  });

  it('Scenario 4 & 5: Provider B duplicate and out-of-order events do not corrupt state', async () => {
    agentRepo.insertAgent({ id: 'ag-b1', name: 'Agent B', status: 'AVAILABLE' });
    leadRepo.insertLead('lead-b1', '+15551111');

    const providerB = new ProviderB({
      minSetupMs: 10,
      maxSetupMs: 20,
      failureRate: 0,
      duplicateRate: 1.0, // Force duplicates
      reorderRate: 1.0,   // Force out-of-order events
    });

    const worker = new DialerWorker({
      workerId: 'worker-chaos-b',
      db,
      mode: 'PROGRESSIVE',
      provider: providerB,
    });

    const tick = await worker.runTick();
    expect(tick.allocated).toBe(1);

    // Let Provider B's duplicated/reordered event emissions settle
    await new Promise((r) => setTimeout(r, 100));

    const callRows = db.prepare('SELECT * FROM calls').all() as any[];
    expect(callRows.length).toBe(1);
    // Verified valid state transition with no crash
    expect(['ANSWERED', 'RINGING', 'CONNECTED', 'COMPLETED']).toContain(callRows[0].status);
  });
});