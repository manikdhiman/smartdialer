export interface PacingContext {
  availableAgents: number;
  activeAgents: number;
  totalAgents: number;
  ringingCalls: number;
  dialingCalls: number;
  connectedCalls: number;
  rollingAnswerRate: number; // 0.0 to 1.0
  avgTalkTimeSeconds: number;
  avgSetupTimeSeconds: number;
}

export interface PacingProposal {
  mode: 'PROGRESSIVE' | 'PREDICTIVE';
  proposedCalls: number;
  reason: string;
  metadata?: Record<string, any>;
}

export interface PacingEngine {
  readonly mode: 'PROGRESSIVE' | 'PREDICTIVE';
  propose(context: PacingContext): PacingProposal;
}