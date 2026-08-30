import { describe, it, expect } from 'vitest';
import {
  canTransitionCall,
  validateCallTransition,
  isTerminalCallState,
  CallState,
} from '../src/domain/call.js';

describe('Call State Machine (Pure Logic)', () => {
  it('allows standard progression: QUEUED -> RESERVED -> INITIATED -> RINGING -> ANSWERED -> CONNECTED -> COMPLETED', () => {
    const happyPath: CallState[] = [
      'QUEUED',
      'RESERVED',
      'INITIATED',
      'RINGING',
      'ANSWERED',
      'CONNECTED',
      'COMPLETED',
    ];

    for (let i = 0; i < happyPath.length - 1; i++) {
      const from = happyPath[i];
      const to = happyPath[i + 1];
      const result = validateCallTransition(from, to);
      expect(result.success, `Expected ${from} -> ${to} to be valid`).toBe(true);
    }
  });

  it('allows fast provider answer: INITIATED -> ANSWERED (skipping RINGING)', () => {
    expect(canTransitionCall('INITIATED', 'ANSWERED')).toBe(true);
  });

  it('allows instant hangup: ANSWERED -> COMPLETED (skipping CONNECTED)', () => {
    expect(canTransitionCall('ANSWERED', 'COMPLETED')).toBe(true);
  });

  it('allows early failures or cancellations from non-terminal states', () => {
    expect(canTransitionCall('QUEUED', 'CANCELLED')).toBe(true);
    expect(canTransitionCall('RESERVED', 'FAILED')).toBe(true);
    expect(canTransitionCall('INITIATED', 'FAILED')).toBe(true);
    expect(canTransitionCall('RINGING', 'CANCELLED')).toBe(true);
  });

  it('strictly rejects any transitions out of terminal states (COMPLETED, FAILED, CANCELLED)', () => {
    const terminals: CallState[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
    const anyNextStates: CallState[] = ['INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED', 'COMPLETED'];

    for (const term of terminals) {
      expect(isTerminalCallState(term)).toBe(true);
      for (const next of anyNextStates) {
        const result = validateCallTransition(term, next);
        expect(result.success, `Terminal ${term} must not transition to ${next}`).toBe(false);
        expect(result.reason).toContain('terminal state');
      }
    }
  });

  it('rejects out-of-order jumps like QUEUED -> CONNECTED', () => {
    const result = validateCallTransition('QUEUED', 'CONNECTED');
    expect(result.success).toBe(false);
  });
});