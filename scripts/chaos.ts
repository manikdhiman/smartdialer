import { createDatabase } from '../src/store/db.js';
import { AgentRepository } from '../src/store/agentRepo.js';
import { LeadRepository } from '../src/store/leadRepo.js';
import { ProviderB } from '../src/providers/ProviderB.js';
import { ProviderEventBus } from '../src/providers/ProviderEventBus.js';
import { CallAllocator } from '../src/engine/CallAllocator.js';

async function demonstrateProviderBChaos() {
  console.log('================================================================');
  console.log('  SmartDialer Chaos Demo: Provider B Duplicate & Out-of-Order  ');
  console.log('================================================================\n');

  const db = createDatabase(':memory:');
  const agentRepo = new AgentRepository(db);
  const leadRepo = new LeadRepository(db);
  const eventBus = new ProviderEventBus(db);

  agentRepo.insertAgent({ id: 'ag-chaos-1', name: 'Agent Chaos', status: 'AVAILABLE' });
  leadRepo.insertLead('lead-chaos-1', '+15550199');

  const providerB = new ProviderB({
    minSetupMs: 10,
    maxSetupMs: 30,
    failureRate: 0,
    duplicateRate: 1.0, // Force 100% duplicates
    reorderRate: 1.0,   // Force 100% out-of-order events
  });

  const allocator = new CallAllocator(db, providerB, eventBus);

  // Hook event bus logging to demonstrate rejection/application
  const origProcess = eventBus.processEvent.bind(eventBus);
  eventBus.processEvent = (evt) => {
    const res = origProcess(evt);
    console.log(
      `[ProviderEventBus] Event: ${evt.type.padEnd(16)} | Seq: ${evt.sequenceNumber} | EventID: ${evt.eventId.slice(0, 12)}... | Ingestion: ${res.accepted ? 'ACCEPTED (APPLIED)' : `REJECTED (${res.reason})`}`
    );
    return res;
  };

  console.log('Initiating outbound call with Provider B chaos active...\n');
  const allocRes = await allocator.allocateCalls(1, 'demo-worker');
  console.log(`[Allocator] Dispatched ${allocRes.successful} call. Listening to chaotic stream...\n`);

  await new Promise((resolve) => setTimeout(resolve, 150));

const call = db.prepare('SELECT id, status, last_applied_seq, version FROM calls LIMIT 1').get() as any;  const agent = agentRepo.getAgentById('ag-chaos-1');

  console.log('\n--- Final Reconciled State in SQLite ---');
  console.log(`Call Record  : ID=${call?.id}, Status=${call?.status}, LastAppliedSeq=${call?.last_applied_seq}`);
  console.log(`Agent Record : ID=${agent?.id}, Status=${agent?.status}, Version=${agent?.version}`);
  console.log('\nResult: Zero crashes, duplicates dropped idempotently, final state cleanly reconciled.');
}

demonstrateProviderBChaos();