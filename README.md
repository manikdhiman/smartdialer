# SmartDialer

A high-concurrency SmartDialer engine for collections contact centers featuring deterministic Progressive Dialing, explainable Erlang-inspired Predictive Pacing, an unbypassable Safety Controller, and optimistic concurrency control (CAS).

---

## 1. Final Design Answer

> **"How would you build a SmartDialer that gets as much of the utilization benefit of predictive dialing as possible, while retaining the deterministic safety characteristics of progressive dialing?"**

We decouple proposal mathematics from dial execution by making the predictive pacing engine strictly advisory and routing all outbound calls through an unbypassable, deterministic **Safety Controller**. The predictive engine computes expected agent turnover and rolling answer rates to propose optimal dial batches, but cannot place calls. The Safety Controller sits directly in front of the allocation layer and unconditionally enforces two non-negotiable boundaries: a **Hard In-Flight Ceiling** ($\text{In-Flight} \le \text{Available Agents} + \text{Buffer}$) and an **Abandonment Circuit Breaker** that immediately falls back to pure $1:1$ progressive dialing for a cooldown window if the rolling abandonment rate exceeds 3%. Under nominal conditions, the system reaps full predictive utilization; under worst-case disruptions (telecom outages, agent drops, answer rate collapse), it mathematically degrades to the deterministic safety of progressive dialing.

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