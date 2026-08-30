import { PacingEngine, PacingContext, PacingProposal } from './PacingEngine.js';

export interface PredictiveEngineConfig {
  answerRateFloor: number;
  maxPacingRatioCap: number; // Max dial-ahead multiplier (e.g., 2.5x - 3.0x)
  maxProposalDeltaPerTick: number;
}

export const DEFAULT_PREDICTIVE_CONFIG: PredictiveEngineConfig = {
  answerRateFloor: 0.15,
  maxPacingRatioCap: 2.5, // Caps dial-ahead to at most 2.5x agent capacity per tick
  maxProposalDeltaPerTick: 10,
};

export class PredictiveEngine implements PacingEngine {
  readonly mode = 'PREDICTIVE' as const;
  private lastProposal = 0;

  constructor(private config: PredictiveEngineConfig = DEFAULT_PREDICTIVE_CONFIG) {}

  reset(): void {
    this.lastProposal = 0;
  }

  propose(context: PacingContext): PacingProposal {
    const effectiveAR = Math.max(context.rollingAnswerRate, this.config.answerRateFloor);
    const avgTalk = Math.max(1, context.avgTalkTimeSeconds);
    const avgSetup = Math.max(1, context.avgSetupTimeSeconds);

    // 1. Forecast agents completing connected calls during the upcoming setup window
    const expectedAgentsFreeingUp = context.connectedCalls * (avgSetup / avgTalk);
    const targetAgentSlots = context.availableAgents + expectedAgentsFreeingUp;

    // 2. Bounded pacing multiplier (1 / AR capped at maxPacingRatioCap)
    const rawPacingRatio = 1 / effectiveAR;
    const pacingRatio = Math.min(rawPacingRatio, this.config.maxPacingRatioCap);

    // 3. Active in-flight calls
    const inFlight = context.dialingCalls + context.ringingCalls;

    // 4. Net calls needed
    const desiredOutbound = Math.ceil(targetAgentSlots * pacingRatio);
    const netCallsNeeded = Math.max(0, desiredOutbound - inFlight);

    // 5. Universal Delta Clamp (including tick 1)
    let finalProposal = netCallsNeeded;
    if (this.lastProposal > 0) {
      const maxAllowed = this.lastProposal + this.config.maxProposalDeltaPerTick;
      const minAllowed = Math.max(0, this.lastProposal - this.config.maxProposalDeltaPerTick);
      finalProposal = Math.min(maxAllowed, Math.max(minAllowed, netCallsNeeded));
    } else {
      // First tick clamp: allow at most maxProposalDeltaPerTick * 2
      finalProposal = Math.min(this.config.maxProposalDeltaPerTick * 2.5, netCallsNeeded);
    }

    this.lastProposal = finalProposal;

    const explanation =
      `Predictive proposal: ${finalProposal} calls | ` +
      `Avail=${context.availableAgents}, Freeing=${expectedAgentsFreeingUp.toFixed(2)}, ` +
      `TargetSlots=${targetAgentSlots.toFixed(2)}, AR=${(effectiveAR * 100).toFixed(0)}%, ` +
      `PacingRatio=${pacingRatio.toFixed(2)}x (raw ${rawPacingRatio.toFixed(2)}x), InFlight=${inFlight}`;

    return {
      mode: 'PREDICTIVE',
      proposedCalls: finalProposal,
      reason: explanation,
      metadata: {
        effectiveAnswerRate: effectiveAR,
        projectedAvailableAgents: targetAgentSlots,
        pacingRatio,
        inFlight,
      },
    };
  }
}