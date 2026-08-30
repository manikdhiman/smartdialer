import { PacingEngine, PacingContext, PacingProposal } from './PacingEngine.js';

export class ProgressiveEngine implements PacingEngine {
  readonly mode = 'PROGRESSIVE' as const;

  propose(context: PacingContext): PacingProposal {
    // Progressive rule: exactly 1 outbound attempt per idle agent minus in-flight dialing
    const inFlight = context.dialingCalls + context.ringingCalls;
    const capacity = Math.max(0, context.availableAgents - inFlight);

    return {
      mode: 'PROGRESSIVE',
      proposedCalls: capacity,
      reason: `Progressive 1:1 pacing with ${context.availableAgents} available agents and ${inFlight} in-flight calls.`,
      metadata: {
        availableAgents: context.availableAgents,
        inFlight,
      },
    };
  }
}