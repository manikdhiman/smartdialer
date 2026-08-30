import { CallState } from './call.js';

export type ProviderEventType =
  | 'CALL_INITIATED'
  | 'CALL_RINGING'
  | 'CALL_ANSWERED'
  | 'CALL_CONNECTED'
  | 'CALL_COMPLETED'
  | 'CALL_FAILED';

export interface ProviderEvent {
  eventId: string;
  callId: string;
  providerCallId: string;
  type: ProviderEventType;
  sequenceNumber: number;
  timestamp: number;
  metadata?: {
    durationMs?: number;
    disconnectReason?: string;
  };
}

export function mapEventToCallState(eventType: ProviderEventType): CallState {
  switch (eventType) {
    case 'CALL_INITIATED':
      return 'INITIATED';
    case 'CALL_RINGING':
      return 'RINGING';
    case 'CALL_ANSWERED':
      return 'ANSWERED';
    case 'CALL_CONNECTED':
      return 'CONNECTED';
    case 'CALL_COMPLETED':
      return 'COMPLETED';
    case 'CALL_FAILED':
      return 'FAILED';
  }
}