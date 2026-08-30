# SmartDialer Architecture & State Machine Specification

## 1. End-to-End Pipeline Topology

The dialing pipeline decouples proposal mathematics from execution. The pacing engine is strictly advisory and cannot dial calls directly; the Safety Controller is the sole authorized writer to the allocator.

```mermaid
flowchart LR
    subgraph Input Layer
        C[Campaign Config / Leased Pool] --> PE[Pacing Engine]
    end

    subgraph Decision Layer
        PE -->|Advisory Proposal| SC[Safety Controller]
        M[Rolling Metrics & Health] -.->|AR, AHT, Setup, Abandonment| SC
        M -.->|AR, AHT, Setup| PE
    end

    subgraph Execution Layer
        SC -->|Approved Call Count| CA[Call Allocator]
        CA -->|Atomic CAS Claim| L[(Leads Table)]
        CA -->|Atomic CAS Reserve| A[(Agents Table)]
        CA -->|Persist Call Record| CL[(Calls Table)]
        CA -->|Dispatch| TP[Telecom Provider]
    end

    subgraph Ingestion Layer
        TP -->|Async Events| EB[Provider Event Bus]
        EB -->|Deduplicate| PEV[(Processed Events)]
        EB -->|Sequence & State Validation| CL
        EB -->|Sync Status| A
        EB -.->|Record Metrics| M
    end