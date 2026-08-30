import { TelecomProvider, EventCallback } from './TelecomProvider.js';
import { ProviderEvent } from '../domain/events.js';
import { randomUUID } from 'node:crypto';

export interface ProviderAConfig {
  minSetupMs?: number;
  maxSetupMs?: number;
  failureRate?: number; // 0.0 to 1.0
}

export class ProviderA implements TelecomProvider {
  readonly name = 'ProviderA';
  private listeners: EventCallback[] = [];

  constructor(private config: ProviderAConfig = { minSetupMs: 20, maxSetupMs: 50, failureRate: 0.02 }) {}

  onEvent(callback: EventCallback): void {
    this.listeners.push(callback);
  }

  private emit(event: ProviderEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error(`[ProviderA] Listener error:`, err);
      }
    }
  }

  async placeCall(callId: string, borrowerNumber: string): Promise<{ providerCallId: string }> {
    const providerCallId = `prv_a_${randomUUID().slice(0, 8)}`;
    const now = Date.now();

    // 1. INITIATED (seq 1)
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

    setTimeout(() => {
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

      // 2. RINGING (seq 2)
      this.emit({
        eventId: `evt_${randomUUID()}`,
        callId,
        providerCallId,
        type: 'CALL_RINGING',
        sequenceNumber: 2,
        timestamp: Date.now(),
      });

      // 3. ANSWERED (seq 3)
      setTimeout(() => {
        this.emit({
          eventId: `evt_${randomUUID()}`,
          callId,
          providerCallId,
          type: 'CALL_ANSWERED',
          sequenceNumber: 3,
          timestamp: Date.now(),
        });

        // 4. CONNECTED (seq 4)
        setTimeout(() => {
          this.emit({
            eventId: `evt_${randomUUID()}`,
            callId,
            providerCallId,
            type: 'CALL_CONNECTED',
            sequenceNumber: 4,
            timestamp: Date.now(),
          });
        }, 10);
      }, setupDelay);
    }, setupDelay);

    return { providerCallId };
  }
}