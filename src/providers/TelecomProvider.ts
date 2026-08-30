import { ProviderEvent } from '../domain/events.js';

export type EventCallback = (event: ProviderEvent) => void | Promise<void>;

export interface TelecomProvider {
  readonly name: string;
  placeCall(callId: string, borrowerNumber: string): Promise<{ providerCallId: string }>;
  onEvent(callback: EventCallback): void;
}