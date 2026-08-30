# SmartDialer

A high-concurrency SmartDialer engine for collections contact centers featuring deterministic Progressive Dialing, explainable Erlang-inspired Predictive Pacing, an unbypassable Safety Controller, and optimistic concurrency control (CAS).

---

## 1. Final Design Answer

> **"How would you build a SmartDialer that gets as much of the utilization benefit of predictive dialing as possible, while retaining the deterministic safety characteristics of progressive dialing?"**

The key idea is to keep the predictive engine's job purely advisory — it only ever suggests how many calls to dial next, based on current agent availability, answer rate, and average call duration. It never places a call itself. Every suggestion passes through a Safety Controller that sits between the pacing logic and the actual dialing, and that controller is the only part of the system allowed to trigger a real call. It enforces two hard rules no matter what the predictive engine suggests: the number of calls in progress can never exceed available agents plus a small buffer, and if the abandonment rate ever crosses 3%, the whole system automatically falls back to plain 1:1 progressive dialing until things stabilize. So when conditions are healthy, the system gets the utilization benefits of predictive dialing, and when something goes wrong — a bad prediction, an agent drop, a provider outage — it behaves exactly as safely as progressive dialing, because the safety logic doesn't depend on the prediction being correct.
---

## 2. Key System Invariants

1. **Bypass-Proof Safety Controller**: The pacing engine is an advisory component producing numerical proposals. The `SafetyController` is the sole authorized writer to the `CallAllocator`, unconditionally enforcing in-flight ceilings and abandonment circuit breakers.
2. **Atomic Concurrency (No In-Memory Locks)**: All agent reservations and lead claims use single-query Compare-And-Swap (CAS) with version columns against SQLite (`node:sqlite` in WAL mode).
3. **Idempotent & Reorder-Tolerant Ingestion**: Telecom events pass through deduplication (`processed_events` table), monotonic sequence verification (`last_applied_seq`), and strict state machine tables.

---

## 3. Project Structure

```text
smartdialer/
├── ARCHITECTURE.md              # Architecture topologies & Mermaid state machine diagrams
├── ADR.md                       # Architecture Decision Records (ADR-001 - ADR-006)
├── package.json / tsconfig.json
├── src/
│   ├── domain/                  # Pure state machines, types, event mappers
│   │   ├── agent.ts
│   │   ├── call.ts
│   │   └── events.ts
│   ├── store/                   # SQLite schema, atomic CAS repositories
│   │   ├── db.ts
│   │   ├── agentRepo.ts
│   │   ├── leadRepo.ts
│   │   └── callRepo.ts
│   ├── providers/               # Provider mocks, health monitor, event bus
│   │   ├── TelecomProvider.ts
│   │   ├── ProviderA.ts         # Fast, reliable (<2% error)
│   │   ├── ProviderB.ts         # Chaos mock (duplicates, reorders, timeouts)
│   │   ├── ProviderEventBus.ts  # Idempotent deduplication & monotonic dispatch
│   │   └── HealthMonitor.ts     # Outage detection & circuit tripping
│   ├── engine/                  # Dialing strategies & safety governor
│   │   ├── PacingEngine.ts      # Shared proposal interface & context DTO
│   │   ├── ProgressiveEngine.ts # 1:1 available agent dialing
│   │   ├── PredictiveEngine.ts  # Explainable Erlang-inspired pacing formula
│   │   ├── SafetyController.ts  # Hard ceilings & abandonment circuit breaker
│   │   └── CallAllocator.ts     # Multi-entity atomic allocation coordinator
│   ├── worker.ts                # Scalable worker loop
│   └── metrics.ts               # Rolling sliding-window metrics collector
├── scripts/
│   ├── simulate.ts              # Scenarios A-D simulation runner
│   ├── loadtest.ts              # Scale benchmark (100 -> 10,000 agents)
│   └── chaos.ts                 # CLI chaos injector
└── test/                        # 8 test suites covering 29 unit, race & chaos tests
```

---

## 4. Failure Scenarios Coverage

All five failure scenarios specified in the brief have dedicated, isolated test suites and runnable chaos demonstrations.

### 1. Worker Crash Mid-Allocation
**Scenario:** Agent reserved → lead reserved → call initiated → worker crashes.
**Demonstrates:** Stale reservations don't leak forever.
**Where to look:** `test/chaos.test.ts` → *Scenario 1*
**Result:** The reservation TTL reaper releases the agent back to `AVAILABLE` within the 20ms TTL window.

---

### 2. Telecom Provider Outage
**Scenario:** Provider error rate spikes sharply.
**Demonstrates:** Existing calls, new calls, and pacing all back off correctly under a failing provider.
**Where to look:** `test/chaos.test.ts` → *Scenario 2*
**Result:** `ProviderHealthMonitor` trips its circuit breaker above a 50% error rate and clamps new outbound dials to 0.

---

### 3. Mass Agent Drop (100 → 40)
**Scenario:** 60 agents disconnect abruptly within a few seconds.
**Demonstrates:** The Safety Controller reacts in real time, not on a delay.
**Where to look:** `test/chaos.test.ts` → *Scenario 3*
**Result:** The concurrent-call ceiling contracts from 101 → 41 on the very next pacing tick.

---

### 4. Duplicate Provider Events
**Scenario:** The same webhook event is delivered more than once.
**Demonstrates:** No event gets processed twice, no matter how many times it arrives.
**Where to look:** `test/chaos.test.ts` → *Scenarios 4–5*, also runnable live via `npm run chaos`
**Result:** The `processed_events` table rejects the repeated `event_id`; the call's state transitions exactly once.

---

### 5. Out-of-Order Events
**Scenario:** e.g. `CALL_ANSWERED` arrives before a delayed `CALL_RINGING`.
**Demonstrates:** The system never crashes or corrupts state when events arrive in the wrong order.
**Where to look:** `test/chaos.test.ts` → *Scenarios 4–5*, also runnable live via `npm run chaos`
**Result:** The `last_applied_seq` monotonic guard silently drops the stale event; no exception, final state stays correct.

---

> **Live demo:** run `npm run chaos` to watch Provider B's duplicate and out-of-order events get
> ingested in real time — each line prints `APPLIED`, `REJECTED — DUPLICATE`, or
> `REJECTED — OUT_OF_ORDER` as it happens.

---

## 5. Quickstart & Commands

**Prerequisites**
- Node.js >= 22.0.0
- npm >= 10.0.0

```bash
# Run All 29 Unit & Chaos Tests
npm test

# Run Simulation Across Scenarios A–D
npm run simulate

# Run Scale Benchmark (100 -> 1,000 -> 10,000 Agents)
npm run loadtest

# Run Live Provider B Chaos Demonstration
npm run chaos
```

---

## 6. Simulation & Benchmark Results

### Scenarios A–D Simulation Output

```
┌─────────┬──────────────────────────────┬──────────────┬─────────────┬───────────┬────────────────┬─────────────────────────┬─────────────────────────────────────┬─────────┐
│ (index) │ scenario                     │ answerRate   │ totalDialed │ connected │ utilizationPct │ pacingDecisions         │ safetyDecisions                     │ ratio   │
├─────────┼──────────────────────────────┼──────────────┼─────────────┼───────────┼────────────────┼─────────────────────────┼─────────────────────────────────────┼─────────┤
│ 0       │ 'Scenario A (Low AR)'        │ '20%'        │ 138         │ 17        │ '85.0%'        │ 'Prop: 323, Alloc: 138' │ 'REDUCE: 15'                        │ '2.34x' │
│ 1       │ 'Scenario B (Balanced)'      │ '50%'        │ 27          │ 20        │ '100.0%'       │ 'Prop: 46, Alloc: 27'   │ 'APPROVE: 1, REDUCE: 3, REJECT: 11' │ '1.70x' │
│ 2       │ 'Scenario C (High AR)'       │ '70%'        │ 28          │ 20        │ '100.0%'       │ 'Prop: 50, Alloc: 28'   │ 'APPROVE: 3, REDUCE: 3, REJECT: 9'  │ '1.79x' │
│ 3       │ 'Scenario D (Dynamic Shift)' │ '70% -> 10%' │ 29          │ 20        │ '100.0%'       │ 'Prop: 48, Alloc: 29'   │ 'APPROVE: 2, REDUCE: 3, REJECT: 10' │ '1.66x' │
└─────────┴──────────────────────────────┴──────────────┴─────────────┴───────────┴────────────────┴─────────────────────────┴─────────────────────────────────────┴─────────┘
```

### Scale Benchmark (100 -> 1,000 -> 10,000 Agents)

```
┌─────────┬───────────────┬───────────────────┬─────────────────────┬───────────┬─────────────────────┬──────────────┬─────────────────┐
│ (index) │ agentPoolSize │ concurrentWorkers │ totalReservationOps │ elapsedMs │ throughputOpsPerSec │ avgLatencyMs │ casConflictRate │
├─────────┼───────────────┼───────────────────┼─────────────────────┼───────────┼─────────────────────┼──────────────┼─────────────────┤
│ 0       │ 100           │ 4                 │ 500                 │ 15        │ 32709               │ 0.031        │ '80.4%'         │
│ 1       │ 1000          │ 16                │ 2000                │ 100       │ 19935               │ 0.050        │ '57.0%'         │
│ 2       │ 10000         │ 64                │ 5000                │ 330       │ 15153               │ 0.066        │ '21.3%'         │
└─────────┴───────────────┴───────────────────┴─────────────────────┴───────────┴─────────────────────┴──────────────┴─────────────────┘
```

---

## 7. Scale Analysis: Bottleneck & Remediation

1. **100 → 1,000 Agents:** Sub-millisecond latency (0.031ms → 0.050ms).
2. **1,000 → 10,000 Agents:** Throughput drops to 15,153 ops/sec due to SQLite WAL single-writer lock serialization.
3. **Remediation:** Migrate the state store to PostgreSQL using row-level locking:

```sql
SELECT id FROM agents
WHERE status = 'AVAILABLE'
LIMIT @batchSize
FOR UPDATE SKIP LOCKED;
```

---

## 8. What I'd Do Differently With Another Week

1. Implement Erlang-C wait probability distributions to model queue dynamics during call holding periods.
2. Build an active-active PostgreSQL adapter with `FOR UPDATE SKIP LOCKED` to dynamically toggle between embedded SQLite and distributed Postgres stores.
