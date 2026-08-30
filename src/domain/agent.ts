export type AgentState =
  | 'OFFLINE'
  | 'AVAILABLE'
  | 'RESERVED'
  | 'DIALING'
  | 'CONNECTED'
  | 'WRAP_UP'
  | 'PAUSED';

export interface Agent {
  id: string;
  name: string;
  status: AgentState;
  version: number;
  reservedByWorkerId: string | null;
  reservedAt: number | null;
  updatedAt: number;
}

export const ALLOWED_AGENT_TRANSITIONS: Record<AgentState, readonly AgentState[]> = {
  OFFLINE: ['AVAILABLE'],
  AVAILABLE: ['RESERVED', 'PAUSED', 'OFFLINE'],
  RESERVED: ['DIALING', 'AVAILABLE', 'OFFLINE'],
  DIALING: ['CONNECTED', 'AVAILABLE', 'OFFLINE'],
  CONNECTED: ['WRAP_UP', 'OFFLINE'],
  WRAP_UP: ['AVAILABLE', 'PAUSED', 'OFFLINE'],
  PAUSED: ['AVAILABLE', 'OFFLINE'],
} as const;

export interface TransitionResult<TState> {
  success: boolean;
  from: TState;
  to: TState;
  error?: string;
}

export function canTransitionAgent(current: AgentState, next: AgentState): boolean {
  if (next === 'OFFLINE' && current !== 'OFFLINE') {
    return true;
  }
  return ALLOWED_AGENT_TRANSITIONS[current].includes(next);
}

export function validateAgentTransition(current: AgentState, next: AgentState): TransitionResult<AgentState> {
  if (!canTransitionAgent(current, next)) {
    return {
      success: false,
      from: current,
      to: next,
      error: `Illegal agent transition from '${current}' to '${next}'.`,
    };
  }
  return {
    success: true,
    from: current,
    to: next,
  };
}