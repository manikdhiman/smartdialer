import { describe, it, expect, beforeEach } from 'vitest';
import { SafetyController, DEFAULT_SAFETY_CONFIG } from '../src/engine/SafetyController.js';
import { PacingProposal, PacingContext } from '../src/engine/PacingEngine.js';

describe('Safety Controller Unit Tests', () => {
  let safetyController: SafetyController;

  const baseContext: PacingContext = {
    availableAgents: 10,
    activeAgents: 5,
    totalAgents: 15,
    ringingCalls: 2,
    dialingCalls: 1,
    connectedCalls: 5,
    rollingAnswerRate: 0.5,
    avgTalkTimeSeconds: 90,
    avgSetupTimeSeconds: 5,
  };

  beforeEach(() => {
    safetyController = new SafetyController({
      ...DEFAULT_SAFETY_CONFIG,
      maxConcurrentCallsGlobal: 50,
      smallBuffer: 2,
      maxAbandonmentRateThreshold: 0.03,
      cooldownWindowMs: 10000,
    });
  });

  it('APPROVES valid proposal within safe boundaries', () => {
    const proposal: PacingProposal = {
      mode: 'PREDICTIVE',
      proposedCalls: 5,
      reason: 'Standard predictive pacing',
    };

    const decision = safetyController.evaluate(proposal, baseContext, { abandonmentRate: 0.01 });

    expect(decision.type).toBe('APPROVE');
    expect(decision.approvedCalls).toBe(5);
    expect(decision.circuitBreakerTripped).toBe(false);
  });

  it('REDUCES absurd proposals (e.g. 500 calls) strictly down to in-flight ceiling', () => {
    const proposal: PacingProposal = {
      mode: 'PREDICTIVE',
      proposedCalls: 500, // Dangerous proposal
      reason: 'Hyper-aggressive model error',
    };

    // Available agents = 10, buffer = 2, max in-flight = 12.
    // Current in-flight = 2 ringing + 1 dialing = 3.
    // Headroom = 12 - 3 = 9.
    const decision = safetyController.evaluate(proposal, baseContext, { abandonmentRate: 0.01 });

    expect(decision.type).toBe('REDUCE');
    expect(decision.approvedCalls).toBe(9);
    expect(decision.requestedCalls).toBe(500);
    expect(decision.reason).toContain('Proposal reduced');
  });

  it('REJECTS proposals when available agent capacity is exhausted', () => {
    const fullContext: PacingContext = {
      ...baseContext,
      availableAgents: 0,
      ringingCalls: 2,
      dialingCalls: 0, // In-flight = 2, max allowed = 0 + 2 (buffer) = 2 -> headroom = 0
    };

    const proposal: PacingProposal = {
      mode: 'PREDICTIVE',
      proposedCalls: 4,
      reason: 'Pacing attempt with 0 agents',
    };

    const decision = safetyController.evaluate(proposal, fullContext, { abandonmentRate: 0.01 });

    expect(decision.type).toBe('REJECT');
    expect(decision.approvedCalls).toBe(0);
  });

  it('TRIPS circuit breaker to FALLBACK_PROGRESSIVE when abandonment rate exceeds 3%', () => {
    const proposal: PacingProposal = {
      mode: 'PREDICTIVE',
      proposedCalls: 10,
      reason: 'Predictive proposal',
    };

    const now = 100000;
    // Abandonment rate is 5% (> 3%)
    const decision = safetyController.evaluate(proposal, baseContext, { abandonmentRate: 0.05, now });

    expect(decision.type).toBe('FALLBACK_PROGRESSIVE');
    expect(decision.circuitBreakerTripped).toBe(true);
    // Progressive ceiling: availableAgents (10) - inFlight (3) = 7
    expect(decision.approvedCalls).toBe(7);

    // Subsequent call during cooldown window remains in FALLBACK_PROGRESSIVE
    const duringCooldown = safetyController.evaluate(
      proposal,
      baseContext,
      { abandonmentRate: 0.01, now: now + 5000 }
    );
    expect(duringCooldown.type).toBe('FALLBACK_PROGRESSIVE');
    expect(duringCooldown.circuitBreakerTripped).toBe(true);

    // After cooldown expiration, reverts to normal evaluation
    const afterCooldown = safetyController.evaluate(
      proposal,
      baseContext,
      { abandonmentRate: 0.01, now: now + 15000 }
    );
    expect(afterCooldown.type).toBe('REDUCE');
    expect(afterCooldown.circuitBreakerTripped).toBe(false);
  });
});