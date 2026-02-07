# VoxYZ Ops-Loop Architecture

This document describes the high-level architecture of the autonomous multi-agent system.

> **📚 For detailed technical documentation, see [docs/ARCHITECTURE_DEEP_DIVE.md](docs/ARCHITECTURE_DEEP_DIVE.md)** for complete data flow diagrams, database schema, API specifications, and scalability analysis.

## 🏗️ Infrastructure
- **Control Plane (Vercel):** Hosts the production API endpoints for heartbeat, proposals, and policy management.
- **Data Engine (Supabase):** PostgreSQL database with real-time capabilities, storing events, missions, and the Demand Radar.
- **Execution Engine (Local Worker):** A background process running on the local system that claims and executes mission steps.

## 🤖 Neural Network (Agents)
The system currently supports 6 specialized agent roles:
1. **Minion (The Builder):** Executes technical tasks and ships code using the Wreckit Engine.
2. **Sage (The Strategist):** Analyzes discovery data and recommends strategic actions.
3. **Scout (The Researcher):** Discovers trends, fetches content, and pitches ideas.
4. **Quill (The Writer):** Crafts high-quality content and drafts.
5. **Xalt (The Publisher):** Manages social media deployment and engagement.
6. **Observer (The Supervisor):** Monitors system health and provides meta-insights.

## 🔄 Core Loop
1. **Events (`ops_agent_events`):** Raw signals (user requests, step successes, external triggers).
2. **Reactions (`ops_agent_reactions`):** Pattern matching engine that maps events to proposal templates.
3. **Proposals (`ops_mission_proposals`):** Gated intents that require manual or auto-approval.
4. **Missions (`ops_missions`):** Approved projects composed of sequential steps.
5. **Execution:** Worker picks up steps and routes them to executors (OpenClaw, Wreckit, Radar, Shell).

## 📡 Control Center
- **Demand Radar:** A 4-stage lifecycle board (Watching -> Validating -> Building -> Shipped) for product ideas.
- **Consciousness Stream:** Real-time visibility into the system's reasoning and internal dialogue.

## 📊 Database Schema

The system uses PostgreSQL with 8 core tables:

- **ops_policy** - Configuration storage (reaction matrix, auto-approval, worker policies)
- **ops_mission_proposals** - Proposal tracking with gated approval
- **ops_missions** - Approved projects with status tracking
- **ops_mission_steps** - Individual execution steps with lease management
- **ops_agent_events** - Event stream for all system signals
- **ops_agent_reactions** - Pattern-matched proposal queue
- **ops_action_runs** - Observability and execution history
- **ops_step_dead_letters** - Permanent step failures for manual review

> **🔗 See [docs/ARCHITECTURE_DEEP_DIVE.md#database-schema](docs/ARCHITECTURE_DEEP_DIVE.md#database-schema)** for complete table definitions, column types, constraints, and relationships.

## 🌐 API Reference

### HTTP Endpoints

- **POST /api/ops/heartbeat** - Triggers event processing, reaction evaluation, and stale step recovery

### Supabase RPC Functions

Key functions include:
- `ops_create_proposal_and_maybe_autoapprove()` - Single entry point for proposal creation
- `ops_gate_proposal()` - Enforces proposal caps and quotas
- `ops_is_auto_approvable()` - Determines auto-approval eligibility
- `ops_claim_next_step()` - Worker lease mechanism
- `ops_recover_stale_steps()` - Stale step detection and recovery

> **🔗 See [docs/API_REFERENCE.md](docs/API_REFERENCE.md)** for complete API documentation with signatures, parameters, and usage examples.

## 📈 Scalability Considerations

### Current Limits

- **Event processing**: 100 events per heartbeat batch
- **Reaction evaluation**: 50 reactions per batch
- **Step lease duration**: 5 minutes (configurable)
- **Worker max retries**: 3 attempts per step
- **Stale step threshold**: 10 minutes

### Scaling Strategies

- **Vertical**: Increase batch sizes and lease durations
- **Horizontal**: Run multiple worker instances (coordination via lease mechanism)
- **Cloud migration**: Move worker from local to VPS for higher availability

> **🔗 See [docs/ARCHITECTURE_DEEP_DIVE.md#scalability-and-performance](docs/ARCHITECTURE_DEEP_DIVE.md#scalability-and-performance)** for detailed scalability analysis.

## 🔍 Monitoring & Observability

### Key Metrics

- Proposal creation rate and approval rate
- Mission success rate and execution time
- Step failure rate and dead letter accumulation
- Event processing latency
- Worker lease utilization

### Logging

- Action runs tracked in `ops_action_runs` table
- Step status transitions logged
- Executor output captured in step results

> **🔗 See [docs/OPERATIONS_RUNBOOK.md#monitoring-and-observability](docs/OPERATIONS_RUNBOOK.md#monitoring-and-observability)** for complete monitoring setup and dashboards.
