import { describe, it, expect, beforeEach } from 'vitest';
import { PredictiveEngine } from '../src/engine/PredictiveEngine.js';
import { PacingContext } from '../src/engine/PacingEngine.js';
import { MetricsCollector } from '../src/metrics.js';

describe('Predictive Pacing Engine & Metrics', () => {
  let engine: PredictiveEngine;

  beforeEach(() => {
    engine = new PredictiveEngine({
      answerRateFloor: 0.10,
      maxProposalDeltaPerTick: 20,
    });
  });

  it('calculates dial-ahead multiplier correctly based on low answer rate (20% AR -> ~5x pacing)', () => {
    const context: PacingContext = {
      availableAgents: 2,
      activeAgents: 8,
      totalAgents: 10,
      ringingCalls: 0,
      dialingCalls: 0,
      connectedCalls: 8,
      rollingAnswerRate: 0.20, // 20%
      avgTalkTimeSeconds: 100,
      avgSetupTimeSeconds: 5,  // 8 * (5/100) = 0.4 agents freeing up
    };

    // Projected agents = 2 + 0.4 = 2.4
    // Target = ceil(2.4 * 5) = 12 calls
    const proposal = engine.propose(context);

    expect(proposal.mode).toBe('PREDICTIVE');
    expect(proposal.proposedCalls).toBe(12);
    expect(proposal.reason).toContain('PacingRatio=5.00x');
  });

  it('dampens proposed calls when answer rate is high (70% AR -> ~1.43x pacing)', () => {
    const highARContext: PacingContext = {
      availableAgents: 5,
      activeAgents: 5,
      totalAgents: 10,
      ringingCalls: 0,
      dialingCalls: 0,
      connectedCalls: 5,
      rollingAnswerRate: 0.70,
      avgTalkTimeSeconds: 120,
      avgSetupTimeSeconds: 6, // 5 * (6/120) = 0.25 agents freeing up
    };

    // Projected agents = 5 + 0.25 = 5.25
    // Target = ceil(5.25 * (1/0.70)) = ceil(5.25 * 1.428) = ceil(7.5) = 8
    const proposal = engine.propose(highARContext);

    expect(proposal.proposedCalls).toBe(8);
    expect(proposal.metadata?.pacingRatio).toBeCloseTo(1.43, 1);
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
    expect(metrics.rollingAnswerRate).toBe(0.5); // 2 answered out of 4
    expect(metrics.avgSetupTimeSeconds).toBe(5);
  });
});