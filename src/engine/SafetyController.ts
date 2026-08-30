import { PacingProposal, PacingContext } from './PacingEngine.js';

export type SafetyDecisionType =
  | 'APPROVE'
  | 'REDUCE'
  | 'REJECT'
  | 'FALLBACK_PROGRESSIVE';

export interface SafetyDecision {
  type: SafetyDecisionType;
  approvedCalls: number;
  requestedCalls: number;
  reason: string;
  circuitBreakerTripped: boolean;
  metadata?: Record<string, any>;
}

export interface SafetyControllerConfig {
  maxConcurrentCallsGlobal: number;
  smallBuffer: number; // Max allowed over-dialing headroom (e.g. 1-2)
  maxAbandonmentRateThreshold: number; // e.g. 0.03 (3%)
  cooldownWindowMs: number; // Cooldown duration after breaker trips
}

export const DEFAULT_SAFETY_CONFIG: SafetyControllerConfig = {
  maxConcurrentCallsGlobal: 100,
  smallBuffer: 1,
  maxAbandonmentRateThreshold: 0.03,
  cooldownWindowMs: 30000,
};

export class SafetyController {
  private breakerTrippedUntil: number | null = null;

  constructor(private config: SafetyControllerConfig = DEFAULT_SAFETY_CONFIG) {}

  /**
   * Evaluates a PacingProposal against hard deterministic safety boundaries.
   */
  evaluate(
    proposal: PacingProposal,
    context: PacingContext,
    metrics: { abandonmentRate: number; now?: number }
  ): SafetyDecision {
    const now = metrics.now ?? Date.now();
    const inFlight = context.dialingCalls + context.ringingCalls;
    const requested = Math.max(0, proposal.proposedCalls);

    // 1. Check Circuit Breaker (Abandonment Rate Spike)
    if (this.breakerTrippedUntil && now < this.breakerTrippedUntil) {
      // Circuit breaker is actively cooling down -> Force progressive
      const safeCapacity = Math.max(0, context.availableAgents - inFlight);
      const approved = Math.min(requested, safeCapacity);
      return {
        type: 'FALLBACK_PROGRESSIVE',
        approvedCalls: approved,
        requestedCalls: requested,
        circuitBreakerTripped: true,
        reason: `Abandonment circuit breaker ACTIVE. Cooldown until ${new Date(this.breakerTrippedUntil).toISOString()}. Fallback to progressive ceiling.`,
      };
    }

    if (metrics.abandonmentRate > this.config.maxAbandonmentRateThreshold) {
      // Trip the breaker
      this.breakerTrippedUntil = now + this.config.cooldownWindowMs;
      const safeCapacity = Math.max(0, context.availableAgents - inFlight);
      const approved = Math.min(requested, safeCapacity);
      return {
        type: 'FALLBACK_PROGRESSIVE',
        approvedCalls: approved,
        requestedCalls: requested,
        circuitBreakerTripped: true,
        reason: `Abandonment rate (${(metrics.abandonmentRate * 100).toFixed(1)}%) exceeded threshold (${(this.config.maxAbandonmentRateThreshold * 100).toFixed(1)}%). Tripping circuit breaker.`,
      };
    }

    // Breaker has expired
    if (this.breakerTrippedUntil && now >= this.breakerTrippedUntil) {
      this.breakerTrippedUntil = null;
    }

    // 2. Compute Hard Upper Boundaries
    // Hard Ceiling: (dialing + ringing) <= availableAgents + smallBuffer
    const maxAllowedInFlight = context.availableAgents + this.config.smallBuffer;
    const headroomByAgents = Math.max(0, maxAllowedInFlight - inFlight);

    // Global Hard Cap boundary
    const totalCurrentCalls = inFlight + context.connectedCalls;
    const headroomByGlobalCap = Math.max(0, this.config.maxConcurrentCallsGlobal - totalCurrentCalls);

    const absoluteMaxNewCalls = Math.min(headroomByAgents, headroomByGlobalCap);

    // 3. Make Final Decision
    if (requested === 0 || absoluteMaxNewCalls === 0) {
      return {
        type: 'REJECT',
        approvedCalls: 0,
        requestedCalls: requested,
        circuitBreakerTripped: false,
        reason: requested === 0
          ? 'Pacing proposed 0 calls.'
          : `Safety ceiling reached (In-flight: ${inFlight}, Available Agents: ${context.availableAgents}, Buffer: ${this.config.smallBuffer}).`,
      };
    }

    if (requested <= absoluteMaxNewCalls) {
      return {
        type: 'APPROVE',
        approvedCalls: requested,
        requestedCalls: requested,
        circuitBreakerTripped: false,
        reason: `Approved full proposal of ${requested} calls.`,
      };
    }

    // If requested exceeds hard ceiling, REDUCE to safe boundary
    return {
      type: 'REDUCE',
      approvedCalls: absoluteMaxNewCalls,
      requestedCalls: requested,
      circuitBreakerTripped: false,
      reason: `Proposal reduced from ${requested} to ${absoluteMaxNewCalls} to respect in-flight ceiling (${maxAllowedInFlight}).`,
    };
  }
}