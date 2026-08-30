import { describe, it, expect, beforeEach } from 'vitest';
import { PredictiveEngine } from '../src/engine/PredictiveEngine.js';
import { PacingContext } from '../src/engine/PacingEngine.js';
import { SafetyController, DEFAULT_SAFETY_CONFIG } from '../src/engine/SafetyController.js';
import { MetricsCollector } from '../src/metrics.js';

describe('Predictive Pacing Engine & Metrics', () => {
  let engine: PredictiveEngine;
  let safetyController: SafetyController;

  beforeEach(() => {
    engine = new PredictiveEngine();
    safetyController = new SafetyController({
      ...DEFAULT_SAFETY_CONFIG,
      smallBuffer: 2,
    });
  });

  it('guarantees different answer rates produce visibly different proposals (50% AR vs 70% AR)', () => {
    const baseContext: PacingContext = {
      availableAgents: 10,
      activeAgents: 10,
      totalAgents: 20,
      ringingCalls: 0,
      dialingCalls: 0,
      connectedCalls: 10,
      rollingAnswerRate: 0.50,
      avgTalkTimeSeconds: 90,
      avgSetupTimeSeconds: 5,
    };

    const engine50 = new PredictiveEngine();
    const proposal50 = engine50.propose({ ...baseContext, rollingAnswerRate: 0.50 });

    const engine70 = new PredictiveEngine();
    const proposal70 = engine70.propose({ ...baseContext, rollingAnswerRate: 0.70 });

    expect(proposal50.proposedCalls).toBeGreaterThan(proposal70.proposedCalls);
  });

  it('asserts proposed-to-approved ratio stays strictly bounded (< 2.5x) across all answer rates (20%, 50%, 70%)', () => {
    const rates = [0.20, 0.50, 0.70];

    for (const ar of rates) {
      const testEngine = new PredictiveEngine();
      const context: PacingContext = {
        availableAgents: 20,
        activeAgents: 0,
        totalAgents: 20,
        ringingCalls: 0,
        dialingCalls: 0,
        connectedCalls: 0,
        rollingAnswerRate: ar,
        avgTalkTimeSeconds: 90,
        avgSetupTimeSeconds: 5,
      };

      const proposal = testEngine.propose(context);
      const decision = safetyController.evaluate(proposal, context, { abandonmentRate: 0.01 });

      const ratio = proposal.proposedCalls / decision.approvedCalls;
      expect(ratio).toBeLessThanOrEqual(2.5);
      expect(decision.approvedCalls).toBeGreaterThan(0);
    }
  });

  it('MetricsCollector correctly calculates rolling stats from call events', () => {
    const collector = new MetricsCollector(60000);
    const now = Date.now();

    collector.recordCall({ callId: 'c1', setupTimeMs: 4000, talkTimeMs: 80000, outcome: 'ANSWERED', timestamp: now });
    collector.recordCall({ callId: 'c2', setupTimeMs: 6000, talkTimeMs: 100000, outcome: 'ANSWERED', timestamp: now });
    collector.recordCall({ callId: 'c3', setupTimeMs: 5000, talkTimeMs: 0, outcome: 'NO_ANSWER', timestamp: now });
    collector.recordCall({ callId: 'c4', setupTimeMs: 5000, talkTimeMs: 0, outcome: 'FAILED', timestamp: now });

    const metrics = collector.getMetrics();
    expect(metrics.sampleSize).toBe(4);
    expect(metrics.rollingAnswerRate).toBe(0.5);
    expect(metrics.avgSetupTimeSeconds).toBe(5);
  });
});