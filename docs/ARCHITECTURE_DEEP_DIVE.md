# VoxYZ Ops-Loop Architecture Deep Dive

## 🏗️ Component Architecture

### Control Plane (Vercel)

The Vercel control plane hosts lightweight Next.js API routes that orchestrate system operations without heavy computation.

**Location:** `./vercel/pages/api/ops/`

**Key Routes:**
- `POST /api/ops/heartbeat` - Main orchestration endpoint
  - Processes unprocessed events from `ops_agent_events`
  - Evaluates reaction matrix patterns
  - Queues matched reactions
  - Processes reaction queue into proposals
  - Recovers stale steps and expired leases
  - Publishes "Consciousness Stream" thoughts

**Architecture Characteristics:**
- **Stateless:** All state stored in Supabase
- **Lightweight:** No heavy computation, only orchestration
- **Authenticated:** Requires `OPS_API_KEY` bearer token
- **Idempotent:** Safe to run multiple times (deduplication via dedupe keys)

**Environment Variables:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin operations
- `OPS_API_KEY` - Bearer token for authentication
- `OPS_EVENT_BATCH_SIZE` - Max events to process per heartbeat (default: 25)
- `OPS_REACTION_BATCH_SIZE` - Max reactions to process per heartbeat (default: 25)

### Data Engine (Supabase)

Supabase provides PostgreSQL database with real-time capabilities, RLS policies, and RPC functions.

**Database:** `nnmgddhlqfumlstopqxs.supabase.co`

**Key Capabilities:**
- **Relational Storage:** 8 core tables (events, reactions, proposals, missions, steps, policy, action_runs)
- **Real-time Subscriptions:** Subscribe to table changes for "Consciousness Stream"
- **RPC Functions:** 9 database-side functions for proposal gating, auto-approval, step claiming
- **Triggers:** Automatic `updated_at` timestamp management
- **Indexes:** Optimized queries for status-based lookups

**Connection Pattern (from configure_sage.js):**
```javascript
const client = new Client({
  connectionString: 'postgresql://postgres:password@db.project.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }
});
```

### Execution Engine (Local Worker)

The worker is a Node.js background process running locally (or on a VPS) that claims and executes mission steps.

**Location:** `./local/src/`

**Key Files:**
- `worker.mjs` - Main worker loop claiming and executing steps
- `heartbeat.mjs` - Local heartbeat (alternative to Vercel deployment)
- `executors/index.mjs` - Executor registry (OpenClaw, Wreckit, Radar, Minion, Noop)

**Execution Pattern:**
1. Poll for queued steps via `ops_claim_next_step()`
2. Route step to appropriate executor based on `executor` field
3. Execute with timeout and retry logic
4. Record result (success/failure) in step
5. Emit completion event
6. Finalize mission if all steps complete

**Environment Variables:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key
- `OPS_STEP_LEASE_MINUTES` - Step execution timeout (default: 5)
- `OPS_WORKER_MAX_RETRIES` - Max retry attempts (default: 3)
- `OPS_STALE_STEP_MINUTES` - Stale step threshold (default: 30)

## 🔄 Data Flow Diagrams

### Complete Event Flow

```mermaid
sequenceDiagram
    participant Source as Event Source
    participant Events as ops_agent_events
    participant HB as Heartbeat API
    participant Policy as ops_policy
    participant Reactions as ops_agent_reactions
    participant RPC as RPC Functions
    participant Proposals as ops_mission_proposals
    participant Missions as ops_missions
    participant Steps as ops_mission_steps
    participant Worker as Local Worker

    Source->>Events: INSERT event
    Note over Events: Unprocessed event<br/>(processed_at = NULL)

    HB->>Events: SELECT unprocessed<br/>(batch size)
    HB->>Policy: GET reaction_matrix

    loop For each pattern
        HB->>HB: matchesPattern()<br/>(type, tags, source)
        HB->>HB: passProbability()<br/>(0-1)
        HB->>Reactions: Check cooldown
        HB->>Reactions: INSERT queued reaction
    end

    HB->>Events: UPDATE processed_at

    HB->>Reactions: SELECT queued
    HB->>RPC: ops_create_proposal_and_maybe_autoapprove()

    RPC->>Policy: GET proposal_caps
    RPC->>Policy: GET auto_approve

    alt Gate passed
        RPC->>Proposals: INSERT proposal

        alt Auto-approve enabled
            RPC->>Proposals: UPDATE status = auto_approved
            RPC->>RPC: ops_create_mission_from_proposal()
            RPC->>Missions: INSERT mission
            RPC->>Steps: INSERT steps (queued)
        end
    else Gate failed
        RPC->>Proposals: INSERT rejected proposal
    end

    Worker->>Steps: SELECT queued
    Worker->>RPC: ops_claim_next_step()
    RPC->>Steps: UPDATE status=running<br/>reserved_at, lease_expires_at

    Worker->>Worker: Route to executor
    Worker->>Worker: Execute step

    alt Success
        Worker->>Steps: UPDATE status=succeeded<br/>result
        Worker->>Events: INSERT step:success event
        Worker->>RPC: ops_maybe_finalize_mission()
    else Failure (retriable)
        Worker->>Steps: UPDATE failure_count+1<br/>last_error
        Worker->>Steps: UPDATE status=queued
    else Failure (max retries)
        Worker->>Steps: UPDATE status=failed
        Worker->>Events: INSERT step:failed event
        Worker->>RPC: ops_maybe_finalize_mission()
    end
```

### Proposal Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> Pending: ops_create_proposal_and_maybe_autoapprove()
    Pending --> AutoApproved: ops_is_auto_approvable() = true
    Pending --> Approved: Manual approval
    Pending --> Rejected: Gate check failed

    AutoApproved --> Running: ops_create_mission_from_proposal()
    Approved --> Running: ops_create_mission_from_proposal()

    Running --> Succeeded: All steps succeeded
    Running --> Failed: Any step failed (max retries)

    Rejected --> [*]
    Succeeded --> [*]
    Failed --> [*]
```

### Mission Step Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Queued: Mission created
    Queued --> Running: Worker claims step<br/>(ops_claim_next_step)

    Running --> Succeeded: Execution success
    Running --> Failed: Execution failure
    Running --> Queued: Lease expires<br/>(stale recovery)

    Failed --> Queued: Retries remaining
    Failed --> [*]: Max retries reached<br/>(dead letter)

    Succeeded --> [*]
```

### Real-time Data Flow (Consciousness Stream)

```mermaid
graph LR
    HB[Heartbeat API] -->|Publishes| Events[ops_agent_events]
    Events -.->|Real-time| RT[Supabase Real-time]
    RT -.->|WebSocket| Dash[Dashboard]
    Worker[Local Worker] -->|Publishes| Events
    Events -.->|Real-time| RT

    style Events fill:#e1f5ff
    style RT fill:#fff4e1
    style Dash fill:#e8f5e9
```

## 📊 Database Schema

### Entity Relationship Diagram

```mermaid
erDiagram
    ops_policy ||--o{ ops_mission_proposals : "governs"
    ops_agent_events ||--o{ ops_agent_reactions : "triggers"
    ops_agent_reactions ||--o| ops_mission_proposals : "creates"
    ops_mission_proposals ||--o|| ops_missions : "generates"
    ops_missions ||--o{ ops_mission_steps : "contains"
    ops_mission_steps ||--o{ ops_action_runs : "executed via"
    ops_missions ||--o{ ops_agent_events : "emits"
    ops_mission_steps ||--o{ ops_agent_events : "emits"

    ops_policy {
        text key PK
        jsonb value "policy data"
        integer version
        timestamptz updated_at
    }

    ops_agent_events {
        uuid id PK
        text dedupe_key UK
        text type "event type"
        jsonb data "event payload"
        uuid mission_id FK
        timestamptz processed_at
        timestamptz created_at
    }

    ops_agent_reactions {
        uuid id PK
        uuid event_id FK
        text status "queued/processing/done/failed"
        jsonb payload "proposal template"
        timestamptz created_at
        timestamptz updated_at
    }

    ops_mission_proposals {
        uuid id PK
        text dedupe_key UK
        text source "api/trigger/reaction/manual"
        ops_proposal_status status "pending/approved/rejected/auto_approved"
        jsonb template "mission template"
        text reason "rejection reason"
        jsonb policy_snapshot
        timestamptz approved_at
        timestamptz created_at
    }

    ops_missions {
        uuid id PK
        uuid proposal_id FK
        ops_mission_status status "approved/running/succeeded/failed"
        jsonb policy_snapshot
        timestamptz started_at
        timestamptz completed_at
        timestamptz created_at
        timestamptz updated_at
    }

    ops_mission_steps {
        uuid id PK
        uuid mission_id FK
        text kind "step type"
        jsonb params "step parameters"
        ops_step_status status "queued/running/succeeded/failed"
        text executor "openclaw/wreckit/radar/minion/noop"
        timestamptz reserved_at
        timestamptz lease_expires_at
        integer failure_count
        integer max_retries
        text last_error
        jsonb result
        timestamptz created_at
        timestamptz updated_at
    }

    ops_action_runs {
        uuid id PK
        text run_id UK
        uuid step_id FK
        text executor
        ops_action_run_status status "started/succeeded/failed"
        timestamptz started_at
        timestamptz completed_at
        jsonb meta
        text error
    }
```

### Table Documentation

#### 1. ops_policy
**Purpose:** Key-value storage for system governance policies

| Column | Type | Description |
|--------|------|-------------|
| `key` | `text` PK | Policy identifier: `reaction_matrix`, `auto_approve`, `proposal_caps`, `worker_policy`, `agent_roles` |
| `value` | `jsonb` | Policy configuration (JSON) |
| `version` | `integer` | Policy version for auditing |
| `updated_at` | `timestamptz` | Last update timestamp |

**Indexes:** Primary key on `key`

#### 2. ops_agent_events
**Purpose:** Raw event stream for all system signals

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | Unique identifier |
| `dedupe_key` | `text` UK | Deduplication key (optional) |
| `type` | `text` | Event type (e.g., `user:request`, `step:success`, `agent:thought`) |
| `data` | `jsonb` | Event payload |
| `mission_id` | `uuid` FK | Associated mission (optional) |
| `processed_at` | `timestamptz` | When heartbeat processed this event |
| `created_at` | `timestamptz` | Event creation time |

**Indexes:**
- `ops_agent_events_type_idx` on `(type, processed_at)` - For heartbeat queries

#### 3. ops_agent_reactions
**Purpose:** Queue for event-triggered proposal templates

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | Unique identifier |
| `event_id` | `uuid` FK | Source event |
| `status` | `text` | `queued`, `processing`, `done`, `failed` |
| `payload` | `jsonb` | Proposal template + metadata |
| `created_at` | `timestamptz` | Creation time |
| `updated_at` | `timestamptz` | Last update time |

**Indexes:**
- `ops_agent_reactions_status_idx` on `(status, created_at)` - For heartbeat queue processing

#### 4. ops_mission_proposals
**Purpose:** Gated intents requiring approval

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | Unique identifier |
| `dedupe_key` | `text` UK | Deduplication key |
| `source` | `text` | `api`, `trigger`, `reaction`, `manual` |
| `status` | `ops_proposal_status` | `pending`, `approved`, `rejected`, `auto_approved` |
| `template` | `jsonb` | Mission template (title, risk_level, steps) |
| `reason` | `text` | Rejection reason (if rejected) |
| `policy_snapshot` | `jsonb` | Policy state at proposal time |
| `approved_at` | `timestamptz` | Approval timestamp |
| `created_at` | `timestamptz` | Creation time |

**Indexes:**
- `ops_mission_proposals_status_idx` on `(status, created_at DESC)` - For pending proposal queries

**Enum: ops_proposal_status**
- `pending` - Awaiting approval
- `approved` - Manually approved
- `rejected` - Gate check failed
- `auto_approved` - Auto-approved by policy

#### 5. ops_missions
**Purpose:** Approved projects composed of sequential steps

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | Unique identifier |
| `proposal_id` | `uuid` FK | Source proposal |
| `status` | `ops_mission_status` | `approved`, `running`, `succeeded`, `failed` |
| `policy_snapshot` | `jsonb` | Policy state at mission creation |
| `started_at` | `timestamptz` | Mission start time |
| `completed_at` | `timestamptz` | Mission completion time |
| `created_at` | `timestamptz` | Creation time |
| `updated_at` | `timestamptz` | Last update time |

**Indexes:**
- `ops_missions_status_idx` on `(status, created_at DESC)` - For active mission queries

**Enum: ops_mission_status**
- `approved` - Ready to start
- `running` - Steps in progress
- `succeeded` - All steps completed successfully
- `failed` - One or more steps failed

#### 6. ops_mission_steps
**Purpose:** Individual execution steps within missions

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | Unique identifier |
| `mission_id` | `uuid` FK | Parent mission |
| `kind` | `text` | Step type (e.g., `draft_tweet`, `openclaw`) |
| `params` | `jsonb` | Step parameters |
| `status` | `ops_step_status` | `queued`, `running`, `succeeded`, `failed` |
| `executor` | `text` | Executor: `openclaw`, `wreckit`, `radar`, `minion`, `noop` |
| `reserved_at` | `timestamptz` | When worker claimed this step |
| `lease_expires_at` | `timestamptz` | Step execution timeout |
| `failure_count` | `integer` | Number of failed attempts |
| `max_retries` | `integer` | Maximum retry attempts |
| `last_error` | `text` | Last error message |
| `result` | `jsonb` | Execution result |
| `created_at` | `timestamptz` | Creation time |
| `updated_at` | `timestamptz` | Last update time |

**Indexes:**
- `ops_mission_steps_status_idx` on `(status, reserved_at)` - For worker claiming
- `ops_mission_steps_mission_idx` on `(mission_id, status)` - For mission finalization

**Enum: ops_step_status**
- `queued` - Awaiting execution
- `running` - Currently executing
- `succeeded` - Completed successfully
- `failed` - Failed (may retry)

#### 7. ops_action_runs
**Purpose:** Observability for executor executions

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | Unique identifier |
| `run_id` | `text` UK | External run identifier |
| `step_id` | `uuid` FK | Associated step |
| `executor` | `text` | Executor type |
| `status` | `ops_action_run_status` | `started`, `succeeded`, `failed` |
| `started_at` | `timestamptz` | Execution start time |
| `completed_at` | `timestamptz` | Execution completion time |
| `meta` | `jsonb` | Execution metadata |
| `error` | `text` | Error message (if failed) |

**Indexes:**
- `ops_action_runs_step_idx` on `(step_id, started_at DESC)` - For step history

**Enum: ops_action_run_status**
- `started` - Execution initiated
- `succeeded` - Completed successfully
- `failed` - Completed with error

## 🔌 API Reference

### Vercel API Endpoints

#### POST /api/ops/heartbeat

Main orchestration endpoint for event processing and system maintenance.

**Authentication:** Bearer token in `Authorization` header
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_OPS_API_KEY" \
  -H "Content-Type: application/json" \
  https://your-project.vercel.app/api/ops/heartbeat
```

**Request Body:** Empty `{}`

**Response Schema:**
```typescript
{
  ok: boolean;
  triggerResult: {
    events: number;        // Events processed
    queued: number;        // Reactions queued
  };
  reactionResult: {
    processed: number;     // Reactions processed
    created: number;       // Proposals created
  };
  learningResult: {
    promoted: number;      // Insights promoted (reserved)
  };
  leaseResult: {
    requeued_steps: number; // Steps with expired leases requeued
    failed_steps: number;   // Steps that failed permanently
  };
  staleResult: {
    recovered: number;     // Stale steps recovered
  };
}
```

**Side Effects:**
- Processes unprocessed events from `ops_agent_events`
- Evaluates reaction matrix patterns
- Queues matched reactions
- Processes reaction queue into proposals
- Recovers stale steps (running longer than threshold)
- Publishes `agent:thought` events for observability

**Rate Limiting:** None (use API key for protection)

### Supabase RPC Functions

#### 1. ops_set_updated_at()
**Trigger helper** for automatic timestamp management.

**Usage:** Automatically invoked by triggers on table updates
```sql
CREATE TRIGGER ops_missions_set_updated_at
  BEFORE UPDATE ON ops_missions
  FOR EACH ROW EXECUTE FUNCTION ops_set_updated_at();
```

#### 2. ops_extract_step_kinds(p_template jsonb)
**Helper function** to extract unique step kinds from proposal template.

**Returns:** `text[]` - Array of step kind strings
```sql
SELECT ops_extract_step_kinds(
  '{"steps": [{"kind": "draft"}, {"kind": "post"}]}'::jsonb
);
-- Returns: {draft,post}
```

#### 3. ops_gate_proposal(p_template jsonb)
**Gate check function** enforcing proposal caps and quotas.

**Returns:** `TABLE(ok boolean, reason text)`
```sql
SELECT * FROM ops_gate_proposal(
  '{"title": "Test", "steps": []}'::jsonb
);
```

**Implementation:**
- Checks `proposal_caps.daily_limit` from `ops_policy`
- Counts proposals created today
- Rejects if daily cap reached

**Extension Point:** Add additional gates (e.g., per-source limits, budget checks)

#### 4. ops_is_auto_approvable(p_template jsonb)
**Auto-approval check function** evaluating policy rules.

**Returns:** `boolean`
```sql
SELECT ops_is_auto_approvable(
  '{"title": "Test", "steps": [{"kind": "noop"}]}'::jsonb
);
```

**Implementation:**
- Checks `auto_approve.enabled` from `ops_policy`
- If enabled, validates all step kinds are in `auto_approve.allowed_step_kinds`
- Returns `true` if all checks pass

**Extension Point:** Add risk scoring, source validation, step inspection

#### 5. ops_create_mission_from_proposal(p_proposal_id uuid)
**Mission creation function** generating mission and steps from proposal.

**Returns:** `uuid` - Mission ID
```sql
SELECT ops_create_mission_from_proposal(
  '123e4567-e89b-12d3-a456-426614174000'
);
```

**Implementation:**
- Retrieves proposal template
- Inserts mission with status `approved`
- Inserts steps from `template.steps` array
- Sets all steps to status `queued`
- Returns mission ID

#### 6. ops_create_proposal_and_maybe_autoapprove(
  p_dedupe_key text,
  p_source text,
  p_template jsonb
)
**Main proposal entry point** combining gating, auto-approval, and mission creation.

**Returns:** `TABLE(proposal_id uuid, status ops_proposal_status, mission_id uuid, reason text)`
```sql
SELECT * FROM ops_create_proposal_and_maybe_autoapprove(
  'unique-key-123',
  'reaction',
  '{"title": "Test", "steps": [{"kind": "noop"}]}'::jsonb
);
```

**Implementation:**
1. Checks for existing proposal with same dedupe_key (returns if exists)
2. Snapshots current policy state
3. Runs gate checks via `ops_gate_proposal()`
4. Inserts proposal (status `pending` or `rejected`)
5. If gates passed, checks auto-approval via `ops_is_auto_approvable()`
6. If auto-approvable, updates status to `auto_approved` and creates mission
7. Returns proposal details

**Transaction Safety:** All operations in single transaction

#### 7. ops_maybe_finalize_mission(p_mission_id uuid)
**Mission finalization function** checking step statuses and updating mission state.

**Returns:** `void`
```sql
SELECT ops_maybe_finalize_mission(
  '123e4567-e89b-12d3-a456-426614174000'
);
```

**Implementation:**
- Counts failed and remaining steps
- If any failed: sets mission status to `failed`, sets `completed_at`
- If no remaining: sets mission status to `succeeded`, sets `completed_at`
- No-op if mission already finalized

**Called by:** Worker after each step completion

#### 8. ops_recover_stale_steps(p_threshold_minutes integer)
**Stale step recovery function** marking long-running steps as failed.

**Returns:** `TABLE(recovered_steps integer)`
```sql
SELECT * FROM ops_recover_stale_steps(30);
```

**Implementation:**
- Finds steps with status `running` and `reserved_at < now() - threshold`
- Updates status to `failed` with error "Stale: no progress within threshold"
- Calls `ops_maybe_finalize_mission()` for affected missions
- Returns count of recovered steps

**Called by:** Heartbeat API

#### 9. ops_claim_next_step(p_lease_minutes integer)
**Atomic step claiming function** for worker execution.

**Returns:** `SETOF ops_mission_steps` - Single claimed step or empty
```sql
SELECT * FROM ops_claim_next_step(5);
```

**Implementation:**
- Finds single queued step (oldest first)
- Uses `FOR UPDATE SKIP LOCKED` for concurrency safety
- Updates status to `running`
- Sets `reserved_at = now()`
- Sets `lease_expires_at = now() + lease_minutes`
- Returns claimed step

**Called by:** Worker main loop

**Concurrency:** Multiple workers can run safely without claiming same step

## 📡 Real-time Architecture

### Supabase Real-time Subscriptions

Ops-Loop leverages Supabase real-time for the "Consciousness Stream" - a live feed of agent thoughts and system state.

**Subscription Pattern:**
```javascript
const { data, error } = supabase
  .channel('ops-consciousness')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'ops_agent_events',
      filter: 'type=eq.agent:thought'
    },
    (payload) => {
      console.log('Agent thought:', payload.new.data);
    }
  )
  .subscribe();
```

**Real-time Use Cases:**
- **Consciousness Stream:** Dashboard shows agent thoughts in real-time
- **Mission Progress:** Monitor step completions as they happen
- **System Health:** Track errors and failures immediately
- **Reaction Monitoring:** See when events trigger proposals

**Benefits:**
- No polling required
- Millisecond latency
- Automatic reconnection
- Filtered subscriptions (e.g., only `agent:thought` events)

**Architecture Note:** Real-time is **observability-only** - no control logic depends on it. All control logic uses RPC functions and polling for reliability.

## ⚡ Scalability and Performance

### Current Limits and Configurations

| Setting | Environment Variable | Default | Purpose |
|---------|---------------------|---------|---------|
| Event batch size | `OPS_EVENT_BATCH_SIZE` | 25 | Max events processed per heartbeat |
| Reaction batch size | `OPS_REACTION_BATCH_SIZE` | 25 | Max reactions processed per heartbeat |
| Step lease minutes | `OPS_STEP_LEASE_MINUTES` | 5 | Step execution timeout |
| Worker max retries | `OPS_WORKER_MAX_RETRIES` | 3 | Max retry attempts per step |
| Stale step minutes | `OPS_STALE_STEP_MINUTES` | 30 | Threshold for stale step recovery |
| Heartbeat interval | Cron | 5 min | Frequency of heartbeat runs |
| Worker interval | Cron | 1 min | Frequency of worker polls |

### Bottleneck Analysis

**Current Constraints:**
1. **Single Worker:** Only one worker process can run (no horizontal scaling)
2. **Vercel Timeout:** Heartbeat must complete within Vercel's 10-second execution limit
3. **Batch Processing:** Large event/reaction queues may take multiple heartbeat cycles
4. **PostgreSQL Connections:** Supabase plan limits concurrent connections

**Throughput Estimates:**
- **Events:** ~25 events per 5 minutes = 300 events/hour
- **Reactions:** ~25 reactions per 5 minutes = 300 reactions/hour
- **Steps:** 1 step per worker poll = 60 steps/hour per worker

**Scaling Strategies:**

1. **Vertical Scaling:**
   - Increase batch sizes (`OPS_EVENT_BATCH_SIZE`, `OPS_REACTION_BATCH_SIZE`)
   - Reduce heartbeat interval (e.g., every 2 minutes instead of 5)
   - Add more workers (only if mission steps are independent)

2. **Horizontal Scaling:**
   - Deploy worker to VPS (e.g., Railway, Fly.io) for 24/7 operation
   - Run multiple worker instances (safe due to `SKIP LOCKED` in `ops_claim_next_step`)
   - Add heartbeat redundancy (multiple Vercel deployments with deduplication)

3. **Database Optimization:**
   - Add composite indexes on high-query tables
   - Archive old events/reactions to separate tables
   - Use connection pooling for high-concurrency scenarios

### Performance Monitoring

**Key Metrics:**
- **Heartbeat Duration:** Time to process one heartbeat cycle
- **Event Queue Depth:** Count of unprocessed events
- **Reaction Queue Depth:** Count of queued reactions
- **Step Execution Time:** Average time from claim to completion
- **Worker Idle Time:** Percentage of polls with no queued steps

**Monitoring Queries:**
```sql
-- Unprocessed events
SELECT count(*) FROM ops_agent_events WHERE processed_at IS NULL;

-- Queued reactions
SELECT count(*) FROM ops_agent_reactions WHERE status = 'queued';

-- Active missions
SELECT count(*) FROM ops_missions WHERE status = 'running';

-- Steps awaiting execution
SELECT count(*) FROM ops_mission_steps WHERE status = 'queued';

-- Long-running steps
SELECT * FROM ops_mission_steps
WHERE status = 'running'
AND reserved_at < now() - interval '5 minutes';
```

---

**Next:** [Agent Guide](AGENT_GUIDE.md) for detailed agent role specifications and configuration.
