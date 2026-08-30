import { createDatabase } from '../src/store/db.js';
import { AgentRepository } from '../src/store/agentRepo.js';
import { LeadRepository } from '../src/store/leadRepo.js';
import { DialerWorker } from '../src/worker.js';
import { TelecomProvider, EventCallback } from '../src/providers/TelecomProvider.js';
import { ProviderEvent } from '../domain/events.js';
import { randomUUID } from 'node:crypto';

class SimProvider implements TelecomProvider {
  readonly name = 'SimProvider';
  private listeners: EventCallback[] = [];
  public answerRate: number;
  public talkTimeMs: number;
  public setupTimeMs: number;

  constructor(answerRate: number, avgTalkTimeSec: number, setupTimeSec = 2) {
    this.answerRate = answerRate;
    // Scale talk time: 10s talk time = 50ms sim time (allows turnover across a 15-tick run)
    this.talkTimeMs = Math.min(120, avgTalkTimeSec * 1.5);
    this.setupTimeMs = setupTimeSec * 5;
  }

  onEvent(callback: EventCallback): void {
    this.listeners.push(callback);
  }

  private emit(event: ProviderEvent): void {
    for (const l of this.listeners) l(event);
  }

  async placeCall(callId: string, borrowerNumber: string): Promise<{ providerCallId: string }> {
    const providerCallId = `prv_sim_${randomUUID().slice(0, 6)}`;
    const isAnswered = Math.random() < this.answerRate;

    this.emit({
      eventId: `evt_${randomUUID()}`,
      callId,
      providerCallId,
      type: 'CALL_INITIATED',
      sequenceNumber: 1,
      timestamp: Date.now(),
    });

    setTimeout(() => {
      if (!isAnswered) {
        this.emit({
          eventId: `evt_${randomUUID()}`,
          callId,
          providerCallId,
          type: 'CALL_FAILED',
          sequenceNumber: 2,
          timestamp: Date.now(),
          metadata: { disconnectReason: 'NO_ANSWER' },
        });
        return;
      }

      this.emit({
        eventId: `evt_${randomUUID()}`,
        callId,
        providerCallId,
        type: 'CALL_ANSWERED',
        sequenceNumber: 2,
        timestamp: Date.now(),
      });

      this.emit({
        eventId: `evt_${randomUUID()}`,
        callId,
        providerCallId,
        type: 'CALL_CONNECTED',
        sequenceNumber: 3,
        timestamp: Date.now(),
      });

      setTimeout(() => {
        this.emit({
          eventId: `evt_${randomUUID()}`,
          callId,
          providerCallId,
          type: 'CALL_COMPLETED',
          sequenceNumber: 4,
          timestamp: Date.now(),
        });
      }, this.talkTimeMs);
    }, this.setupTimeMs);

    return { providerCallId };
  }
}

interface ScenarioResult {
  scenario: string;
  answerRate: string;
  totalDialed: number;
  connected: number;
  utilizationPct: string;
  pacingDecisions: string;
  ratio: string;
}

async function runScenario(
  name: string,
  initialAR: number,
  talkTimeSec: number,
  ticks = 15,
  midRunShift?: { atTick: number; newAR: number }
): Promise<ScenarioResult> {
  const db = createDatabase(':memory:');
  const agentRepo = new AgentRepository(db);
  const leadRepo = new LeadRepository(db);

  const totalAgents = 20;
  for (let i = 1; i <= totalAgents; i++) {
    agentRepo.insertAgent({ id: `ag-${i}`, name: `Agent ${i}`, status: 'AVAILABLE' });
  }
  for (let i = 1; i <= 500; i++) {
    leadRepo.insertLead(`lead-${i}`, `+1555${1000 + i}`);
  }

  const provider = new SimProvider(initialAR, talkTimeSec);
  const worker = new DialerWorker({
    workerId: `worker-${name}`,
    db,
    mode: 'PREDICTIVE',
    provider,
    reservationTtlMs: 2000,
    initialAnswerRate: initialAR,
  });

  let totalProposed = 0;
  let totalAllocated = 0;

  for (let tick = 1; tick <= ticks; tick++) {
    if (midRunShift && tick === midRunShift.atTick) {
      provider.answerRate = midRunShift.newAR;
      worker.metricsCollector.seedInitialMetrics(midRunShift.newAR);
    }
    const res = await worker.runTick();
    totalProposed += res.proposed;
    totalAllocated += res.allocated;
    await new Promise((r) => setTimeout(r, 70));
  }

  const connectedCount = db.prepare("SELECT COUNT(*) as count FROM calls WHERE status IN ('CONNECTED', 'COMPLETED')").get() as any;
  const dialedCount = db.prepare("SELECT COUNT(*) as count FROM calls").get() as any;
  const activeAgents = totalAgents - agentRepo.countAvailableAgents();
  const util = ((activeAgents / totalAgents) * 100).toFixed(1);
  const ratio = (totalProposed / Math.max(1, totalAllocated)).toFixed(2) + 'x';

  return {
    scenario: name,
    answerRate: `${(initialAR * 100).toFixed(0)}%` + (midRunShift ? ` -> ${(midRunShift.newAR * 100).toFixed(0)}%` : ''),
    totalDialed: Number(dialedCount.count),
    connected: Number(connectedCount.count),
    utilizationPct: `${util}%`,
    pacingDecisions: `Proposed: ${totalProposed}, Allocated: ${totalAllocated}`,
    ratio,
  };
}

async function main() {
  console.log('Running SmartDialer Scenarios A-D Calibrated Simulation...\n');

  const results: ScenarioResult[] = [];
  results.push(await runScenario('Scenario A (Low AR)', 0.20, 120));
  results.push(await runScenario('Scenario B (Balanced)', 0.50, 90));
  results.push(await runScenario('Scenario C (High AR)', 0.70, 180));
  results.push(await runScenario('Scenario D (Dynamic Shift)', 0.70, 90, 15, { atTick: 7, newAR: 0.10 }));

  console.table(results);
  console.log('\nSimulation completed successfully.');
}

main();