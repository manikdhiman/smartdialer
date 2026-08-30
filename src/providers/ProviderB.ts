import { TelecomProvider, EventCallback } from './TelecomProvider.js';
import { ProviderEvent } from '../domain/events.js';
import { randomUUID } from 'node:crypto';

export interface ProviderBConfig {
  minSetupMs?: number;
  maxSetupMs?: number;
  failureRate?: number;
  duplicateRate?: number;
  reorderRate?: number;
}

export class ProviderB implements TelecomProvider {
  readonly name = 'ProviderB';
  private listeners: EventCallback[] = [];

  constructor(
    private config: ProviderBConfig = {
      minSetupMs: 50,
      maxSetupMs: 150,
      failureRate: 0.15,
      duplicateRate: 0.2,
      reorderRate: 0.2,
    }
  ) {}

  onEvent(callback: EventCallback): void {
    this.listeners.push(callback);
  }

  private emit(event: ProviderEvent): void {
    const shouldDuplicate = Math.random() < (this.config.duplicateRate ?? 0.2);

    for (const listener of this.listeners) {
      try {
        listener(event);
        if (shouldDuplicate) {
          // Emit duplicate identical event after small delay
          setTimeout(() => listener(event), 10);
        }
      } catch (err) {
        console.error(`[ProviderB] Listener error:`, err);
      }
    }
  }

  async placeCall(callId: string, borrowerNumber: string): Promise<{ providerCallId: string }> {
    const providerCallId = `prv_b_${randomUUID().slice(0, 8)}`;
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

    const isFailure = Math.random() < (this.config.failureRate ?? 0.15);
    const shouldReorder = Math.random() < (this.config.reorderRate ?? 0.2);
    const setupDelay = Math.floor(
      Math.random() * ((this.config.maxSetupMs ?? 150) - (this.config.minSetupMs ?? 50)) +
        (this.config.minSetupMs ?? 50)
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
          metadata: { disconnectReason: 'PROVIDER_TIMEOUT' },
        });
        return;
      }

      if (shouldReorder) {
        // Chaos: Emit ANSWERED (seq 3) BEFORE RINGING (seq 2)
        this.emit({
          eventId: `evt_${randomUUID()}`,
          callId,
          providerCallId,
          type: 'CALL_ANSWERED',
          sequenceNumber: 3,
          timestamp: Date.now(),
        });

        setTimeout(() => {
          this.emit({
            eventId: `evt_${randomUUID()}`,
            callId,
            providerCallId,
            type: 'CALL_RINGING',
            sequenceNumber: 2, // Out-of-order sequence
            timestamp: Date.now(),
          });
        }, 15);
      } else {
        // Normal progression
        this.emit({
          eventId: `evt_${randomUUID()}`,
          callId,
          providerCallId,
          type: 'CALL_RINGING',
          sequenceNumber: 2,
          timestamp: Date.now(),
        });

        setTimeout(() => {
          this.emit({
            eventId: `evt_${randomUUID()}`,
            callId,
            providerCallId,
            type: 'CALL_ANSWERED',
            sequenceNumber: 3,
            timestamp: Date.now(),
          });
        }, setupDelay / 2);
      }
    }, setupDelay);

    return { providerCallId };
  }
}