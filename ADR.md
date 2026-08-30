# Architecture Decision Records (ADR)

## ADR-001: Strict Deterministic Transition Tables for Domain State Machines

### Status: Accepted (Phase 1)

### Context
In automated dialing environments with multiple workers and unpredictable telecom providers, events arrive out-of-order, duplicated, or prematurely. Hardcoding transition logic as ad-hoc `if/else` checks across application code leads to inconsistent state, phantom reservations, and uncaught edge cases.

### Decision
We model both the `Agent` and `Call` lifecycles as strict partial-order finite state machines defined by compile-time typed static lookup tables (`ALLOWED_AGENT_TRANSITIONS`, `ALLOWED_CALL_TRANSITIONS`). All state transitions pass through pure validation functions before any persistence layer is touched. Terminal states (`COMPLETED`, `FAILED`, `CANCELLED`) have empty transition sets (`[]`).

### Trade-offs & Consequences
- **Positive:** Out-of-order events on terminal calls (e.g. `COMPLETED` followed by late `RINGING`) are rejected deterministically in O(1) without throwing uncaught exceptions.
- **Positive:** Compile-time safety via TypeScript string literal unions eliminates typo-driven transition bugs.
- **Trade-off:** Adding a new valid transition requires updating the static table and associated test suites explicitly.


## ADR-002: Optimistic Concurrency Control via Versioned CAS in SQLite

### Status: Accepted (Phase 2)

### Context
When multiple worker processes dial campaigns concurrently, multiple workers query the database and attempt to reserve the same idle agents or claim the same borrower leads. Pessimistic in-memory locks fail across multiple OS processes.

### Decision
All state transitions on `agents` and `leads` employ an atomic Compare-And-Swap (CAS) pattern in SQL:
`UPDATE ... SET status = :next, version = version + 1 WHERE id = :id AND status = :expectedStatus AND version = :expectedVersion`.
The database engine's modified row count (`changes === 1`) dictates race ownership. Stale reservations from crashed workers are reclaimed via a periodic TTL Reaper.

### Trade-offs & Consequences
- **Positive:** Works natively across separate processes sharing a SQLite file without external lock-managers like Redis.
- **Positive:** Zero chance of duplicate agent reservation or double dialing a borrower lead.
- **Trade-off:** Under extreme contention (e.g. 1000+ agents), losing workers must re-query. We transition to Postgres row-level locks (`SKIP LOCKED`) if write contention exceeds single-writer SQLite limits.


## ADR-003: Deduplication and Monotonic Ingestion Bus for Asynchronous Telecom Events

### Status: Accepted (Phase 3)

### Context
Telecom carriers transmit webhook events over unreliable networks, resulting in duplicate deliveries, out-of-order transitions, and events arriving after a call has terminated.

### Decision
Event ingestion is guarded by a two-tiered filter before triggering state transitions:
1. **Idempotency Guard**: Every event's `eventId` is recorded in a `processed_events` table using `INSERT OR IGNORE`. Duplicate deliveries return 0 inserted rows and exit immediately.
2. **Monotonic Sequence & Terminal Guard**: Calls track `last_applied_seq`. Any event with `sequenceNumber <= last_applied_seq` or targeting a terminal state (`COMPLETED`, `FAILED`, `CANCELLED`) is logged and dropped without mutating state or throwing unhandled errors.

### Trade-offs & Consequences
- **Positive:** Immune to network replay and out-of-order race conditions.
- **Positive:** Zero data corruption when mock providers (e.g. Provider B) inject chaos.
- **Trade-off:** Requires persistence write for event tracking.


## ADR-004: Decoupling Pacing Strategy Proposals from Allocation Execution

### Status: Accepted (Phase 4)

### Context
In dialer architectures, tight coupling between pacing algorithms and dial-execution logic leads to accidental dial-storms, race conditions, and lack of deterministic safety boundaries.

### Decision
Pacing engines (`PacingEngine` interface) are pure advisors returning proposal DTOs (`{ proposedCalls, reason }`). They possess zero references to database repos, lock handlers, or telecom providers. The `CallAllocator` is the sole coordinator translating approved batch sizes into CAS lead claims, agent reservations, call creation, and telecom dispatches.

### Trade-offs & Consequences
- **Positive:** Pacing logic is easily unit tested with mock inputs.
- **Positive:** Progressive and predictive strategies are plug-and-play interchangeable without rewriting allocation transactions.


## ADR-005: Safety Controller as the Unbypassable Dialing Boundary

### Status: Accepted (Phase 5)

### Context
Predictive pacing algorithms maximize agent utilization by dialing ahead of expected agent availability. However, mathematical misestimations, network delays, or abrupt answer rate shifts can produce compliance-violating abandonment spikes or dial storms.

### Decision
The `SafetyController` is the sole authorized writer of approved call counts. It unconditionally enforces:
1. **Hard In-Flight Ceiling**: `(DIALING + RINGING) <= availableAgents + buffer`.
2. **Global Concurrency Ceiling**: `totalInFlight <= maxConcurrentGlobal`.
3. **Abandonment Circuit Breaker**: If rolling abandonment rate > 3%, the system trips into a 30s progressive fallback cooldown.
`PacingEngine` cannot place calls or disable the Safety Controller.

### Trade-offs & Consequences
- **Positive:** Mathematically proves that the system can never perform worse than deterministic progressive dialing in worst-case failure modes.
- **Trade-off:** High bursts of agent availability are clamped to the buffer window rather than unboundedly spiked.