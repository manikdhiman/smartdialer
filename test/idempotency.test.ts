import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../src/store/db.js';
import { CallRepository } from '../src/store/callRepo.js';
import { LeadRepository } from '../src/store/leadRepo.js';
import { AgentRepository } from '../src/store/agentRepo.js';
import { ProviderEventBus } from '../src/providers/ProviderEventBus.js';
import { ProviderEvent } from '../domain/events.js';

describe('Idempotency & Out-of-Order Event Handling', () => {
  let db: DatabaseSync;
  let callRepo: CallRepository;
  let leadRepo: LeadRepository;
  let agentRepo: AgentRepository;
  let eventBus: ProviderEventBus;

  beforeEach(() => {
    db = createDatabase(':memory:');
    callRepo = new CallRepository(db);
    leadRepo = new LeadRepository(db);
    agentRepo = new AgentRepository(db);
    eventBus = new ProviderEventBus(db);

    leadRepo.insertLead('lead-1', '+15550001');
    agentRepo.insertAgent({ id: 'agent-1', name: 'Bob', status: 'AVAILABLE' });
  });

  afterEach(() => {
    db.close();
  });

  it('Feed 1: Triplicate ANSWERED events followed by COMPLETED', () => {
    const call = callRepo.createCall('call-101', 'lead-1', 'agent-1');
    callRepo.transitionCall(call.id, call.version, 'RESERVED');
    const reservedCall = callRepo.getCallById(call.id)!;
    callRepo.transitionCall(reservedCall.id, reservedCall.version, 'INITIATED');

    const answeredEvent: ProviderEvent = {
      eventId: 'evt-ans-1',
      callId: 'call-101',
      providerCallId: 'prv-1',
      type: 'CALL_ANSWERED',
      sequenceNumber: 2,
      timestamp: Date.now(),
    };

    // 1st delivery -> Accepted
    const res1 = eventBus.processEvent(answeredEvent);
    expect(res1.accepted).toBe(true);
    expect(res1.reason).toBe('APPLIED');
    expect(callRepo.getCallById('call-101')!.status).toBe('ANSWERED');

    // 2nd delivery (duplicate eventId) -> Dropped
    const res2 = eventBus.processEvent(answeredEvent);
    expect(res2.accepted).toBe(false);
    expect(res2.reason).toBe('DUPLICATE');

    // 3rd delivery (duplicate eventId) -> Dropped
    const res3 = eventBus.processEvent(answeredEvent);
    expect(res3.accepted).toBe(false);
    expect(res3.reason).toBe('DUPLICATE');

    // COMPLETED -> Applied
    const completedEvent: ProviderEvent = {
      eventId: 'evt-comp-1',
      callId: 'call-101',
      providerCallId: 'prv-1',
      type: 'CALL_COMPLETED',
      sequenceNumber: 3,
      timestamp: Date.now(),
    };
    const res4 = eventBus.processEvent(completedEvent);
    expect(res4.accepted).toBe(true);
    expect(res4.reason).toBe('APPLIED');
    expect(callRepo.getCallById('call-101')!.status).toBe('COMPLETED');
  });

  it('Feed 2: Reversed arrivals: COMPLETED arrives before ANSWERED and RINGING', () => {
    const call = callRepo.createCall('call-102', 'lead-1', 'agent-1');
    callRepo.transitionCall(call.id, call.version, 'RESERVED');
    const reservedCall = callRepo.getCallById(call.id)!;
    callRepo.transitionCall(reservedCall.id, reservedCall.version, 'INITIATED');

    // 1. COMPLETED arrives first with seq = 4
    const compEvent: ProviderEvent = {
      eventId: 'evt-c-1',
      callId: 'call-102',
      providerCallId: 'prv-2',
      type: 'CALL_COMPLETED',
      sequenceNumber: 4,
      timestamp: Date.now(),
    };
    const resComp = eventBus.processEvent(compEvent);
    expect(resComp.accepted).toBe(true);
    expect(callRepo.getCallById('call-102')!.status).toBe('COMPLETED');

    // 2. Late ANSWERED arrives with seq = 3 (lower seq than 4)
    const ansEvent: ProviderEvent = {
      eventId: 'evt-a-1',
      callId: 'call-102',
      providerCallId: 'prv-2',
      type: 'CALL_ANSWERED',
      sequenceNumber: 3,
      timestamp: Date.now(),
    };
    const resAns = eventBus.processEvent(ansEvent);
    expect(resAns.accepted).toBe(false);
    expect(resAns.reason).toBe('OUT_OF_ORDER');

    // 3. Late RINGING arrives with seq = 2
    const ringEvent: ProviderEvent = {
      eventId: 'evt-r-1',
      callId: 'call-102',
      providerCallId: 'prv-2',
      type: 'CALL_RINGING',
      sequenceNumber: 2,
      timestamp: Date.now(),
    };
    const resRing = eventBus.processEvent(ringEvent);
    expect(resRing.accepted).toBe(false);
    expect(resRing.reason).toBe('OUT_OF_ORDER');

    // Call remains in terminal COMPLETED state without errors
    expect(callRepo.getCallById('call-102')!.status).toBe('COMPLETED');
  });
});