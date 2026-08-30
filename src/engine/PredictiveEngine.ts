import { PacingEngine, PacingContext, PacingProposal } from './PacingEngine.js';

export interface PredictiveEngineConfig {
  answerRateFloor: number; // Prevent divide-by-zero (e.g., 0.10)
  maxProposalDeltaPerTick: number; // Max step change per tick to prevent oscillation
}

export const DEFAULT_PREDICTIVE_CONFIG: PredictiveEngineConfig = {
  answerRateFloor: 0.10,
  maxProposalDeltaPerTick: 15,
};

export class PredictiveEngine implements PacingEngine {
  readonly mode = 'PREDICTIVE' as const;
  private lastProposal = 0;

  constructor(private config: PredictiveEngineConfig = DEFAULT_PREDICTIVE_CONFIG) {}

  propose(context: PacingContext): PacingProposal {
    const effectiveAnswerRate = Math.max(context.rollingAnswerRate, this.config.answerRateFloor);
    const avgTalkTime = Math.max(1, context.avgTalkTimeSeconds);
    const setupTime = Math.max(1, context.avgSetupTimeSeconds);

    // 1. Forecast agents finishing current calls during setup window
    const expectedAgentsFreeingUpSoon = context.connectedCalls * (setupTime / avgTalkTime);
    const projectedAvailableAgents = context.availableAgents + expectedAgentsFreeingUpSoon;

    // 2. Compute dial-ahead multiplier (pacing ratio)
    const pacingRatio = 1 / effectiveAnswerRate;

    // 3. Raw target calls minus calls already ringing
    const rawTarget = Math.ceil(projectedAvailableAgents * pacingRatio) - context.ringingCalls;
    const clampedRaw = Math.max(0, rawTarget);

    // 4. Dampen proposal deltas (avoid abrupt spikes)
    let finalProposal = clampedRaw;
    if (this.lastProposal > 0) {
      const maxAllowed = this.lastProposal + this.config.maxProposalDeltaPerTick;
      const minAllowed = Math.max(0, this.lastProposal - this.config.maxProposalDeltaPerTick);
      finalProposal = Math.min(maxAllowed, Math.max(minAllowed, clampedRaw));
    }

    this.lastProposal = finalProposal;

    const explanation =
      `Predictive proposal: ${finalProposal} calls | ` +
      `AvailAgents=${context.availableAgents}, FreeingSoon=${expectedAgentsFreeingUpSoon.toFixed(2)}, ` +
      `Projected=${projectedAvailableAgents.toFixed(2)}, AR=${(effectiveAnswerRate * 100).toFixed(0)}%, ` +
      `PacingRatio=${pacingRatio.toFixed(2)}x, Ringing=${context.ringingCalls}`;

    return {
      mode: 'PREDICTIVE',
      proposedCalls: finalProposal,
      reason: explanation,
      metadata: {
        effectiveAnswerRate,
        projectedAvailableAgents,
        pacingRatio,
        ringingCalls: context.ringingCalls,
      },
    };
  }
}