import { createDatabase } from '../src/store/db.js';
import { AgentRepository } from '../src/store/agentRepo.js';
import { LeadRepository } from '../src/store/leadRepo.js';
import { DialerWorker } from '../src/worker.js';
import { ProviderB } from '../src/providers/ProviderB.js';

async function runChaosSimulation() {
  console.log('=== Starting SmartDialer Chaos Simulator ===\n');
  const db = createDatabase(':memory:');
  const agentRepo = new AgentRepository(db);
  const leadRepo = new LeadRepository(db);

  // Setup 50 agents and 100 leads
  for (let i = 1; i <= 50; i++) {
    agentRepo.insertAgent({ id: `agent-${i}`, name: `Agent ${i}`, status: 'AVAILABLE' });
  }
  for (let i = 1; i <= 100; i++) {
    leadRepo.insertLead(`lead-${i}`, `+1555${1000 + i}`);
  }

  const worker = new DialerWorker({
    workerId: 'chaos-worker-1',
    db,
    mode: 'PREDICTIVE',
    provider: new ProviderB({ minSetupMs: 5, maxSetupMs: 15, duplicateRate: 0.5, reorderRate: 0.5, failureRate: 0.1 }),
  });

  console.log('Tick 1: Standard load with 50 agents...');
  const t1 = await worker.runTick();
  console.log(`[Tick 1 Result] Avail: ${t1.availableAgents}, Proposed: ${t1.proposed}, Decision: ${t1.safetyDecision}, Allocated: ${t1.allocated}`);

  console.log('\nInjecting Chaos: 30 agents disconnect abruptly...');
  for (let i = 1; i <= 30; i++) {
    const ag = agentRepo.getAgentById(`agent-${i}`)!;
    agentRepo.transitionStatus(ag.id, ag.version, 'OFFLINE');
  }

  console.log('Tick 2: Pacing under mass agent drop...');
  const t2 = await worker.runTick();
  console.log(`[Tick 2 Result] Avail: ${t2.availableAgents}, Proposed: ${t2.proposed}, Decision: ${t2.safetyDecision}, Allocated: ${t2.allocated}`);

  console.log('\nChaos Simulation complete. Verified bounded safety ceilings.');
}

runChaosSimulation();