export type CallState =
  | 'QUEUED'
  | 'RESERVED'
  | 'INITIATED'
  | 'RINGING'
  | 'ANSWERED'
  | 'CONNECTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface Call {
  id: string;
  leadId: string;
  agentId: string | null;
  status: CallState;
  version: number;
  providerCallId: string | null;
  initiatedAt: number | null;
  answeredAt: number | null;
  connectedAt: number | null;
  completedAt: number | null;
  failedReason: string | null;
  lastAppliedSeq: number;
  updatedAt: number;
}

export const ALLOWED_CALL_TRANSITIONS: Record<CallState, readonly CallState[]> = {
  QUEUED: ['RESERVED', 'CANCELLED'],
  RESERVED: ['INITIATED', 'CANCELLED', 'FAILED'],
  INITIATED: ['RINGING', 'ANSWERED', 'COMPLETED', 'FAILED', 'CANCELLED'], // Allowed if provider emits early hangup/completed
  RINGING: ['ANSWERED', 'COMPLETED', 'FAILED', 'CANCELLED'],             // Allowed if caller drops during ring
  ANSWERED: ['CONNECTED', 'COMPLETED', 'FAILED'],
  CONNECTED: ['COMPLETED', 'FAILED'],
  COMPLETED: [], // Terminal
  FAILED: [],    // Terminal
  CANCELLED: [], // Terminal
} as const;

export const TERMINAL_CALL_STATES: ReadonlySet<CallState> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export function isTerminalCallState(status: CallState): boolean {
  return TERMINAL_CALL_STATES.has(status);
}

export function canTransitionCall(current: CallState, next: CallState): boolean {
  return ALLOWED_CALL_TRANSITIONS[current].includes(next);
}

export function validateCallTransition(
  current: CallState,
  next: CallState
): { success: boolean; from: CallState; to: CallState; reason?: string } {
  if (isTerminalCallState(current)) {
    return {
      success: false,
      from: current,
      to: next,
      reason: `Cannot transition from terminal state '${current}'. Event dropped.`,
    };
  }

  if (!canTransitionCall(current, next)) {
    return {
      success: false,
      from: current,
      to: next,
      reason: `Illegal call transition from '${current}' to '${next}'. Event dropped.`,
    };
  }

  return {
    success: true,
    from: current,
    to: next,
  };
}