import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from './store/db.js';
import { AgentRepository } from './store/agentRepo.js';
import { LeadRepository } from './store/leadRepo.js';
import { CallRepository } from './store/callRepo.js';
import { PacingEngine, PacingContext } from './engine/PacingEngine.js';
import { ProgressiveEngine } from './engine/ProgressiveEngine.js';
import { PredictiveEngine } from './engine/PredictiveEngine.js';
import { SafetyController, DEFAULT_SAFETY_CONFIG } from './engine/SafetyController.js';
import { CallAllocator } from './engine/CallAllocator.js';
import { TelecomProvider } from './providers/TelecomProvider.js';
import { ProviderA } from './providers/ProviderA.js';
import { ProviderEventBus } from './providers/ProviderEventBus.js';
import { MetricsCollector } from './metrics.js';
import { ProviderHealthMonitor } from './providers/HealthMonitor.js';

export interface WorkerOptions {
  workerId: string;
  db?: DatabaseSync;
  dbPath?: string;
  mode?: 'PROGRESSIVE' | 'PREDICTIVE';
  provider?: TelecomProvider;
  tickIntervalMs?: number;
  reservationTtlMs?: number;
}

export class DialerWorker {
  readonly workerId: string;
  private db: DatabaseSync;
  private agentRepo: AgentRepository;
  private leadRepo: LeadRepository;
  private callRepo: CallRepository;
  private eventBus: ProviderEventBus;
  private pacingEngine: PacingEngine;
  private safetyController: SafetyController;
  private allocator: CallAllocator;
  private metricsCollector: MetricsCollector;
  private healthMonitor: ProviderHealthMonitor;
  private isRunning = false;
  private tickIntervalMs: number;
  private reservationTtlMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: WorkerOptions) {
    this.workerId = options.workerId;
    this.db = options.db ?? createDatabase(options.dbPath ?? ':memory:');
    this.agentRepo = new AgentRepository(this.db);
    this.leadRepo = new LeadRepository(this.db);
    this.callRepo = new CallRepository(this.db);
    this.eventBus = new ProviderEventBus(this.db);
    this.metricsCollector = new MetricsCollector();
    this.healthMonitor = new ProviderHealthMonitor();

    const provider = options.provider ?? new ProviderA();
    this.allocator = new CallAllocator(this.db, provider, this.eventBus);

    this.pacingEngine = options.mode === 'PREDICTIVE' ? new PredictiveEngine() : new ProgressiveEngine();
    this.safetyController = new SafetyController(DEFAULT_SAFETY_CONFIG);
    this.tickIntervalMs = options.tickIntervalMs ?? 1000;
    this.reservationTtlMs = options.reservationTtlMs ?? 5000;
  }

  async runTick(): Promise<{
    availableAgents: number;
    proposed: number;
    safetyDecision: string;
    allocated: number;
  }> {
    // 1. Run Maintenance Reapers (crash recovery)
    this.agentRepo.reapStaleReservations(this.reservationTtlMs);
    this.leadRepo.reapStaleClaims(this.reservationTtlMs);

    // 2. Query Current System Concurrency State
    const availableAgents = this.agentRepo.countAvailableAgents();
    const rows = this.db.prepare(`
      SELECT 
        SUM(CASE WHEN status = 'RINGING' THEN 1 ELSE 0 END) as ringing,
        SUM(CASE WHEN status = 'INITIATED' THEN 1 ELSE 0 END) as dialing,
        SUM(CASE WHEN status = 'CONNECTED' THEN 1 ELSE 0 END) as connected
      FROM calls WHERE status IN ('INITIATED', 'RINGING', 'CONNECTED')
    `).get() as any;

    const ringingCalls = Number(rows?.ringing ?? 0);
    const dialingCalls = Number(rows?.dialing ?? 0);
    const connectedCalls = Number(rows?.connected ?? 0);

    const metrics = this.metricsCollector.getMetrics();
    const health = this.healthMonitor.getStatus();

    const context: PacingContext = {
      availableAgents,
      activeAgents: connectedCalls,
      totalAgents: availableAgents + connectedCalls,
      ringingCalls,
      dialingCalls,
      connectedCalls,
      rollingAnswerRate: metrics.rollingAnswerRate,
      avgTalkTimeSeconds: metrics.avgTalkTimeSeconds,
      avgSetupTimeSeconds: metrics.avgSetupTimeSeconds,
    };

    // 3. Pacing Engine Proposes Batch
    const proposal = this.pacingEngine.propose(context);

    // 4. Safety Controller Validates and Governs
    let safetyDecision = this.safetyController.evaluate(proposal, context, {
      abandonmentRate: metrics.abandonmentRate,
    });

    // If Provider is unhealthy, clamp to 0
    if (!health.isHealthy) {
      safetyDecision = {
        type: 'REJECT',
        approvedCalls: 0,
        requestedCalls: proposal.proposedCalls,
        circuitBreakerTripped: true,
        reason: 'Provider unhealthy: outage circuit breaker active',
      };
    }

    // 5. Allocate approved calls
    let allocated = 0;
    if (safetyDecision.approvedCalls > 0) {
      const res = await this.allocator.allocateCalls(safetyDecision.approvedCalls, this.workerId);
      allocated = res.successful;
    }

    return {
      availableAgents,
      proposed: proposal.proposedCalls,
      safetyDecision: `${safetyDecision.type} (${safetyDecision.approvedCalls})`,
      allocated,
    };
  }

  start(): void {
    this.isRunning = true;
    const loop = async () => {
      if (!this.isRunning) return;
      try {
        await this.runTick();
      } catch (err) {
        console.error(`[Worker ${this.workerId}] Tick error:`, err);
      }
      if (this.isRunning) {
        this.timer = setTimeout(loop, this.tickIntervalMs);
      }
    };
    loop();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
  }
}