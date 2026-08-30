# SmartDialer

A high-concurrency SmartDialer engine for collections contact centers featuring deterministic Progressive Dialing, explainable Erlang-inspired Predictive Pacing, an unbypassable Safety Controller, and optimistic concurrency control (CAS).

---

## 1. System Overview & Key Invariants

1. **Bypass-Proof Safety Controller**: The pacing engine is an advisory component producing numerical proposals. The `SafetyController` is the sole authorized writer to the `CallAllocator`, unconditionally enforcing in-flight ceilings and abandonment circuit breakers.
2. **Atomic Concurrency (No In-Memory Locks)**: All agent reservations and lead claims use single-query Compare-And-Swap (CAS) with version columns against SQLite (`node:sqlite` in WAL mode).
3. **Idempotent & Reorder-Tolerant Ingestion**: Telecom events pass through deduplication (`processed_events` table), monotonic sequence verification (`last_applied_seq`), and strict state machine tables.

---

## 2. Project Structure

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

3. Quickstart & Commands

Prerequisites

1) Node.js >= 22.0.0
2) npm >= 10.0.0

Run Tests
Bash -> npm test
Run Simulation (Scenarios A–D)
Bash -> npm run simulate
Run Scale Benchmark
Bash ->npm run loadtest
Run Chaos Demonstration
Bash ->npm run chaos

4. Simulation & Benchmark Results

Scenarios A–D Simulation Output

┌─────────┬──────────────────────────────┬──────────────┬─────────────┬───────────┬────────────────┬─────────────────────────────────┬─────────┐
│ (index) │ scenario                     │ answerRate   │ totalDialed │ connected │ utilizationPct │ pacingDecisions                 │ ratio   │
├─────────┼──────────────────────────────┼──────────────┼─────────────┼───────────┼────────────────┼─────────────────────────────────┼─────────┤
│ 0       │ 'Scenario A (Low AR)'        │ '20%'        │ 132         │ 20        │ '100.0%'       │ 'Proposed: 312, Allocated: 132' │ '2.36x' │
│ 1       │ 'Scenario B (Balanced)'      │ '50%'        │ 37          │ 20        │ '100.0%'       │ 'Proposed: 68, Allocated: 37'   │ '1.84x' │
│ 2       │ 'Scenario C (High AR)'       │ '70%'        │ 22          │ 20        │ '100.0%'       │ 'Proposed: 45, Allocated: 22'   │ '2.05x' │
│ 3       │ 'Scenario D (Dynamic Shift)' │ '70% -> 10%' │ 28          │ 20        │ '100.0%'       │ 'Proposed: 48, Allocated: 28'   │ '1.71x' │
└─────────┴──────────────────────────────┴──────────────┴─────────────┴───────────┴────────────────┴─────────────────────────────────┴─────────┘

Scale Benchmark (100 -> 1,000 -> 10,000 Agents)

┌─────────┬───────────────┬───────────────────┬─────────────────────┬───────────┬─────────────────────┬──────────────┬─────────────────┐
│ (index) │ agentPoolSize │ concurrentWorkers │ totalReservationOps │ elapsedMs │ throughputOpsPerSec │ avgLatencyMs │ casConflictRate │
├─────────┼───────────────┼───────────────────┼─────────────────────┼───────────┼─────────────────────┼──────────────┼─────────────────┤
│ 0       │ 100           │ 4                 │ 500                 │ 15        │ 32709               │ 0.031        │ '80.4%'         │
│ 1       │ 1000          │ 16                │ 2000                │ 100       │ 19935               │ 0.050        │ '57.0%'         │
│ 2       │ 10000         │ 64                │ 5000                │ 330       │ 15153               │ 0.066        │ '21.3%'         │
└─────────┴───────────────┴───────────────────┴─────────────────────┴───────────┴─────────────────────┴──────────────┴─────────────────┘

5. Architectural Defense: Predictive Benefit with Progressive Safety

Core Question: How would you build a SmartDialer that gets as much of the utilization benefit of predictive dialing as possible, while retaining the deterministic safety characteristics of progressive dialing?

Defense
Keep predictive pacing purely advisory. The predictive engine calculates dial-ahead proposals using rolling answer rates, average handle times, and setup latencies, exporting full mathematical inputs so every proposal is inspectable.

Crucially, the predictive engine has no execution capabilities and cannot place calls directly. All proposals pass through an unbypassable Safety Controller that enforces two hard invariants:

In-Flight Ceiling: Total dialing and ringing calls can never exceed available agents plus a strict small buffer:
In-Flight <= Available Agents + Buffer

Abandonment Circuit Breaker: If rolling call abandonment exceeds 3%, the system trips into an automated progressive fallback mode for a cooldown window.

Predictive pacing explores utilization headroom during stable conditions, while the deterministic Safety Controller guarantees that under worst-case failures (outages, sudden agent dropouts, cratering answer rates), the system behaves with the deterministic safety of pure progressive dialing.

### Part 3: Git Commit and Push

Run these commands in PowerShell:

```powershell
git add .
git commit -m "fix: recalibrate pacing clamp, wire dynamic shift metrics, and update documentation"
git push origin main
