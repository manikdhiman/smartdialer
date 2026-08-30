# SmartDialer Architecture & State Machine Specification

1) End-to-End Pipeline Topology

The dialing pipeline decouples proposal mathematics from execution. The pacing engine is strictly advisory and cannot dial calls directly; the Safety Controller is the sole authorized writer to the allocator.

```mermaid
flowchart LR
    subgraph Input_Layer [Input Layer]
        C[Campaign Config / Leased Pool] --> PE[Pacing Engine]
    end

    subgraph Decision_Layer [Decision Layer]
        PE -->|Advisory Proposal| SC[Safety Controller]
        M[Rolling Metrics & Health] -.->|AR, AHT, Setup, Abandonment| SC
        M -.->|AR, AHT, Setup| PE
    end

    subgraph Execution_Layer [Execution Layer]
        SC -->|Approved Call Count| CA[Call Allocator]
        CA -->|Atomic CAS Claim| L[(Leads Table)]
        CA -->|Atomic CAS Reserve| A[(Agents Table)]
        CA -->|Persist Call Record| CL[(Calls Table)]
        CA -->|Dispatch| TP[Telecom Provider]
    end

    subgraph Ingestion_Layer [Ingestion Layer]
        TP -->|Async Events| EB[Provider Event Bus]
        EB -->|Deduplicate| PEV[(Processed Events)]
        EB -->|Sequence & State Validation| CL
        EB -->|Sync Status| A
        EB -.->|Record Metrics| M
    end

2) Agent State Machine
Agents follow a strict partial-order lifecycle. Any active state can transition to OFFLINE if the agent disconnects.

stateDiagram-v2
    [*] --> OFFLINE
    OFFLINE --> AVAILABLE: Login
    AVAILABLE --> RESERVED: Atomic CAS by Worker
    RESERVED --> DIALING: Call Initiated
    RESERVED --> AVAILABLE: Reservation Timeout / Reaper
    DIALING --> CONNECTED: Call Answered
    DIALING --> AVAILABLE: Call Setup Failure
    CONNECTED --> WRAP_UP: Call Completed
    CONNECTED --> OFFLINE: Agent Mid-Call Drop
    WRAP_UP --> AVAILABLE: Ready
    WRAP_UP --> PAUSED: Break
    AVAILABLE --> PAUSED: Agent Pauses
    PAUSED --> AVAILABLE: Agent Resumes
    
    AVAILABLE --> OFFLINE: Logout
    PAUSED --> OFFLINE: Logout
    RESERVED --> OFFLINE: Disconnect
    WRAP_UP --> OFFLINE: Logout

3) Call State Machine
Incoming provider events are validated against the transition table. Terminal states (COMPLETED, FAILED, CANCELLED) reject all subsequent events in $O(1)$ without error.

stateDiagram-v2
    [*] --> QUEUED
    QUEUED --> RESERVED: Allocated to Worker
    QUEUED --> CANCELLED: Campaign Stopped
    RESERVED --> INITIATED: Sent to Provider
    RESERVED --> FAILED: Provider Rejected
    RESERVED --> CANCELLED: Operator Cancelled
    INITIATED --> RINGING: Carrier Ringing
    INITIATED --> ANSWERED: Fast Connect (Skipped Ring)
    INITIATED --> COMPLETED: Immediate Hangup
    INITIATED --> FAILED: Network Timeout / Busy
    RINGING --> ANSWERED: Picked Up
    RINGING --> COMPLETED: Early Disconnect
    RINGING --> FAILED: No Answer / Busy
    RINGING --> CANCELLED: Abandoned
    ANSWERED --> CONNECTED: Bridged to Agent
    ANSWERED --> COMPLETED: Quick Hangup
    ANSWERED --> FAILED: Bridge Error
    CONNECTED --> COMPLETED: Call Ended Normally
    CONNECTED --> FAILED: Mid-Call Drop
    COMPLETED --> [*]
    FAILED --> [*]
    CANCELLED --> [*]

4) Concurrency & Event Safety Guardrails

    1)Agent / Lead Double Reservation: Solved via atomic Compare-And-Swap (CAS) in SQL:

    UPDATE agents
    SET status = 'RESERVED', version = version + 1, reserved_by = @workerId, reserved_at = @now, updated_at = @now
    WHERE id = @agentId AND status = 'AVAILABLE' AND version = @expectedVersion;

    Only the worker receiving changes === 1 proceeds; losing workers re-query.

    2) Reaper Sweeper: Stale reservations (RESERVED > 5s) are reclaimed by the maintenance loop to prevent orphaned allocations.

    3) Idempotency: Webhook deliveries insert into processed_events(event_id). Duplicates return changes === 0 and are immediately dropped.

    4) Monotonic Event Ordering: Events carry a sequence number. If seq <= last_applied_seq, the event is dropped as stale.


### Final Push Command

```powershell
git add ARCHITECTURE.md
git commit -m "docs: save full ARCHITECTURE.md"
git push origin main



