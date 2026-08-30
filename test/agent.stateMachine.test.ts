import { describe, it, expect } from 'vitest';
import {
  canTransitionAgent,
  validateAgentTransition,
  AgentState,
} from '../src/domain/agent.js';

describe('Agent State Machine (Pure Logic)', () => {
  it('allows all valid forward transitions in the happy path', () => {
    const path: AgentState[] = [
      'OFFLINE',
      'AVAILABLE',
      'RESERVED',
      'DIALING',
      'CONNECTED',
      'WRAP_UP',
      'AVAILABLE',
    ];

    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const result = validateAgentTransition(from, to);
      expect(result.success, `Expected ${from} -> ${to} to be valid`).toBe(true);
    }
  });

  it('allows reservation timeout rollback (RESERVED -> AVAILABLE)', () => {
    expect(canTransitionAgent('RESERVED', 'AVAILABLE')).toBe(true);
  });

  it('allows call failure rollback (DIALING -> AVAILABLE)', () => {
    expect(canTransitionAgent('DIALING', 'AVAILABLE')).toBe(true);
  });

  it('allows pausing and unpausing (AVAILABLE <-> PAUSED)', () => {
    expect(canTransitionAgent('AVAILABLE', 'PAUSED')).toBe(true);
    expect(canTransitionAgent('PAUSED', 'AVAILABLE')).toBe(true);
  });

  it('allows dropping to OFFLINE from any active state', () => {
    const states: AgentState[] = ['AVAILABLE', 'RESERVED', 'DIALING', 'CONNECTED', 'WRAP_UP', 'PAUSED'];
    for (const state of states) {
      expect(canTransitionAgent(state, 'OFFLINE'), `Expected ${state} -> OFFLINE to be allowed`).toBe(true);
    }
  });

  it('rejects illegal jumps', () => {
    expect(canTransitionAgent('OFFLINE', 'CONNECTED')).toBe(false);
    expect(canTransitionAgent('OFFLINE', 'RESERVED')).toBe(false);
    expect(canTransitionAgent('PAUSED', 'CONNECTED')).toBe(false);
    expect(canTransitionAgent('RESERVED', 'WRAP_UP')).toBe(false);
  });
});