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
  private activeTimers: Set<NodeJS.Timeout> = new Set();

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

  destroy(): void {
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.listeners = [];
  }

  private emit(event: ProviderEvent): void {
    const shouldDuplicate = Math.random() < (this.config.duplicateRate ?? 0.2);

    for (const listener of this.listeners) {
      try {
        listener(event);
        if (shouldDuplicate) {
          const dupTimer = setTimeout(() => {
            this.activeTimers.delete(dupTimer);
            try {
              listener(event);
            } catch {}
          }, 10);
          this.activeTimers.add(dupTimer);
        }
      } catch (err) {}
    }
  }

  async placeCall(callId: string, borrowerNumber: string): Promise<{ providerCallId: string }> {
    const providerCallId = `prv_b_${randomUUID().slice(0, 8)}`;
    const now = Date.now();

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
          metadata: { disconnectReason: 'PROVIDER_TIMEOUT' },
        });
        return;
      }

      if (shouldReorder) {
        this.emit({
          eventId: `evt_${randomUUID()}`,
          callId,
          providerCallId,
          type: 'CALL_ANSWERED',
          sequenceNumber: 3,
          timestamp: Date.now(),
        });

        const t2 = setTimeout(() => {
          this.activeTimers.delete(t2);
          this.emit({
            eventId: `evt_${randomUUID()}`,
            callId,
            providerCallId,
            type: 'CALL_RINGING',
            sequenceNumber: 2,
            timestamp: Date.now(),
          });
        }, 15);
        this.activeTimers.add(t2);
      } else {
        this.emit({
          eventId: `evt_${randomUUID()}`,
          callId,
          providerCallId,
          type: 'CALL_RINGING',
          sequenceNumber: 2,
          timestamp: Date.now(),
        });

        const t3 = setTimeout(() => {
          this.activeTimers.delete(t3);
          this.emit({
            eventId: `evt_${randomUUID()}`,
            callId,
            providerCallId,
            type: 'CALL_ANSWERED',
            sequenceNumber: 3,
            timestamp: Date.now(),
          });
        }, setupDelay / 2);
        this.activeTimers.add(t3);
      }
    }, setupDelay);
    this.activeTimers.add(t1);

    return { providerCallId };
  }
}