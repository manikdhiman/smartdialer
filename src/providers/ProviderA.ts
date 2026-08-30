import { TelecomProvider, EventCallback } from './TelecomProvider.js';
import { ProviderEvent } from '../domain/events.js';
import { randomUUID } from 'node:crypto';

export interface ProviderAConfig {
  minSetupMs?: number;
  maxSetupMs?: number;
  failureRate?: number;
}

export class ProviderA implements TelecomProvider {
  readonly name = 'ProviderA';
  private listeners: EventCallback[] = [];
  private activeTimers: Set<NodeJS.Timeout> = new Set();

  constructor(private config: ProviderAConfig = { minSetupMs: 20, maxSetupMs: 50, failureRate: 0.02 }) {}

  onEvent(callback: EventCallback): void {
    this.listeners.push(callback);
  }

  destroy(): void {
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.listeners = [];
  }

  private emit(event: ProviderEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // Listener drop guard
      }
    }
  }

  async placeCall(callId: string, borrowerNumber: string): Promise<{ providerCallId: string }> {
    const providerCallId = `prv_a_${randomUUID().slice(0, 8)}`;
    const now = Date.now();

    this.emit({
      eventId: `evt_${randomUUID()}`,
      callId,
      providerCallId,
      type: 'CALL_INITIATED',
      sequenceNumber: 1,
      timestamp: now,
    });

    const isFailure = Math.random() < (this.config.failureRate ?? 0.02);
    const setupDelay = Math.floor(
      Math.random() * ((this.config.maxSetupMs ?? 50) - (this.config.minSetupMs ?? 20)) +
        (this.config.minSetupMs ?? 20)
    );

    const t1 = setTimeout(() => {
      this.activeTimers.delete(t1);
      if (isFailure) {
        this.emit({
          eventId: `evt_${randomUUID()}`,
          callId,
          providerCallId,
          type: 'CALL_FAILED',
          sequenceNumber: 2,
          timestamp: Date.now(),
          metadata: { disconnectReason: 'NETWORK_BUSY' },
        });
        return;
      }

      this.emit({
        eventId: `evt_${randomUUID()}`,
        callId,
        providerCallId,
        type: 'CALL_RINGING',
        sequenceNumber: 2,
        timestamp: Date.now(),
      });

      const t2 = setTimeout(() => {
        this.activeTimers.delete(t2);
        this.emit({
          eventId: `evt_${randomUUID()}`,
          callId,
          providerCallId,
          type: 'CALL_ANSWERED',
          sequenceNumber: 3,
          timestamp: Date.now(),
        });

        const t3 = setTimeout(() => {
          this.activeTimers.delete(t3);
          this.emit({
            eventId: `evt_${randomUUID()}`,
            callId,
            providerCallId,
            type: 'CALL_CONNECTED',
            sequenceNumber: 4,
            timestamp: Date.now(),
          });
        }, 10);
        this.activeTimers.add(t3);
      }, setupDelay);
      this.activeTimers.add(t2);
    }, setupDelay);
    this.activeTimers.add(t1);

    return { providerCallId };
  }
}