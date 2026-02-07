# VoxYZ Ops-Loop API Reference

## 📋 Overview

This document provides comprehensive reference documentation for all APIs, RPC functions, database schemas, and data structures in the VoxYZ Ops-Loop system.

**Target Audience:** Developers integrating with Ops-Loop, operators building custom tooling, and anyone working directly with the database or HTTP endpoints.

**API Categories:**
- **Supabase RPC Functions** - Database-level functions for proposals, missions, and steps
- **HTTP Endpoints** - Vercel-hosted REST APIs
- **Database Tables** - Complete schema reference
- **Event Schemas** - Event and reaction data structures
- **Proposal Templates** - Mission proposal structure and validation

---

## 🔧 Supabase RPC Functions

### ops_create_proposal_and_maybe_autoapprove

**Purpose:** Single entry point for creating mission proposals with automatic approval and mission creation.

**Signature:**
```sql
ops_create_proposal_and_maybe_autoapprove(
  p_dedupe_key text,
  p_source text,
  p_template jsonb
)
returns table (proposal_id uuid, status ops_proposal_status, mission_id uuid, reason text)
```

**Parameters:**
- `p_dedupe_key` (text, optional) - Unique identifier to prevent duplicate proposals. If a proposal with this key exists, returns existing proposal without creating a new one.
- `p_source` (text, required) - Source of the proposal. Must be one of: `'api'`, `'trigger'`, `'reaction'`, `'manual'`
- `p_template` (jsonb, required) - Proposal template containing mission steps. See [Proposal Template Schema](#proposal-template-schema)

**Returns:** Setof record with columns:
- `proposal_id` (uuid) - ID of the proposal (existing or newly created)
- `status` (ops_proposal_status) - Status of the proposal: `'pending'`, `'approved'`, `'rejected'`, `'auto_approved'`
- `mission_id` (uuid, nullable) - ID of the created mission if auto-approved, otherwise null
- `reason` (text, nullable) - Reason for rejection if rejected

**Behavior:**
1. Checks if a proposal with `p_dedupe_key` already exists. If yes, returns existing proposal.
2. Snapshots current policy from `ops_policy` table.
3. Runs proposal gating checks via `ops_gate_proposal()`.
   - If rejected: Creates proposal with status `'rejected'` and reason.
4. Creates proposal with status `'pending'`.
5. Checks auto-approval via `ops_is_auto_approvable()`.
   - If auto-approved: Updates status to `'auto_approved'`, creates mission via `ops_create_mission_from_proposal()`.
   - If not auto-approved: Returns proposal with `'pending'` status.

**Usage Example:**
```sql
select * from ops_create_proposal_and_maybe_autoapprove(
  'test-proposal-001',
  'manual',
  '{
    "title": "Deploy to production",
    "risk_level": "high",
    "steps": [
      {
        "kind": "wreckit",
        "params": {"command": "deploy", "id": "prod"}
      }
    ]
  }'::jsonb
);
```

**Error Conditions:**
- Invalid `p_source` value (not in allowed enum)
- Invalid `p_template` jsonb structure
- Database connection errors

**Related Functions:**
- `ops_gate_proposal()` - Checks proposal caps and quotas
- `ops_is_auto_approvable()` - Determines auto-approval eligibility
- `ops_create_mission_from_proposal()` - Creates mission from approved proposal

**File Reference:** `./supabase/migrations/0002_ops_functions.sql:141-203`

---

### ops_gate_proposal

**Purpose:** Checks proposal caps and quotas to prevent excessive proposal creation.

**Signature:**
```sql
ops_gate_proposal(p_template jsonb)
returns table (ok boolean, reason text)
```

**Parameters:**
- `p_template` (jsonb, required) - Proposal template (not currently used in logic but required for future extensions)

**Returns:** Setof record with columns:
- `ok` (boolean) - `true` if proposal passes gate checks, `false` if rejected
- `reason` (text, nullable) - Human-readable reason for rejection

**Behavior:**
1. Retrieves `proposal_caps` policy from `ops_policy` table.
2. Checks `daily_limit` if configured.
3. Counts proposals created today (since midnight UTC).
4. If count >= daily_limit, returns `ok=false` with reason `'Daily proposal cap reached'`.
5. Otherwise, returns `ok=true`.

**Current Checks:**
- Daily proposal limit

**Future Extensions:**
- Per-source limits
- Per-user limits
- Rate limiting
- Custom quota rules

**Usage Example:**
```sql
select * from ops_gate_proposal('{"title": "test"}'::jsonb);
-- Returns: (ok=true, reason=null) or (ok=false, reason='Daily proposal cap reached')
```

**Policy Configuration:**
```json
{
  "proposal_caps": {
    "daily_limit": 100,
    "per_source_limits": {
      "api": 50,
      "reaction": 200
    }
  }
}
```

**Error Conditions:**
- Database query errors

**Related Functions:**
- `ops_create_proposal_and_maybe_autoapprove()` - Calls this function for gating

**File Reference:** `./supabase/migrations/0002_ops_functions.sql:52-78`

---

### ops_is_auto_approvable

**Purpose:** Determines if a proposal should be automatically approved based on policy configuration.

**Signature:**
```sql
ops_is_auto_approvable(p_template jsonb)
returns boolean
```

**Parameters:**
- `p_template` (jsonb, required) - Proposal template containing steps to evaluate

**Returns:** Boolean
- `true` - Proposal should be auto-approved
- `false` - Proposal requires manual approval

**Behavior:**
1. Retrieves `auto_approve` policy from `ops_policy` table.
2. If policy is null, returns `false` (auto-approval disabled).
3. Checks `enabled` flag. If `false`, returns `false`.
4. If `allowed_step_kinds` is null (no restrictions), returns `true`.
5. Extracts step kinds from template via `ops_extract_step_kinds()`.
6. If template has no steps, returns `false`.
7. Checks if all step kinds are in `allowed_step_kinds` whitelist.
   - If any step kind is not allowed, returns `false`.
8. Returns `true` if all checks pass.

**Decision Tree:**
```
Is auto_approve policy configured?
  ├─ No → false (manual approval required)
  └─ Yes → Is enabled flag true?
      ├─ No → false (manual approval required)
      └─ Yes → Are there allowed_step_kinds restrictions?
          ├─ No → true (auto-approve all)
          └─ Yes → Are all template steps in allowed list?
              ├─ No → false (unsafe step kind)
              └─ Yes → true (auto-approve)
```

**Usage Example:**
```sql
select ops_is_auto_approvable('{
  "steps": [
    {"kind": "noop", "params": {}}
  ]
}'::jsonb);
-- Returns: true or false depending on policy
```

**Policy Configuration:**
```json
{
  "auto_approve": {
    "enabled": true,
    "allowed_step_kinds": ["noop", "minion", "radar"]
  }
}
```

**Error Conditions:**
- Invalid jsonb structure
- Database query errors

**Related Functions:**
- `ops_extract_step_kinds()` - Extracts step kinds from template
- `ops_create_proposal_and_maybe_autoapprove()` - Calls this function

**File Reference:** `./supabase/migrations/0002_ops_functions.sql:80-112`

---

### ops_create_mission_from_proposal

**Purpose:** Creates a mission and associated steps from an approved proposal.

**Signature:**
```sql
ops_create_mission_from_proposal(p_proposal_id uuid)
returns uuid
```

**Parameters:**
- `p_proposal_id` (uuid, required) - ID of the approved proposal

**Returns:** UUID - ID of the newly created mission

**Behavior:**
1. Retrieves proposal `template` and `policy_snapshot` by ID.
2. If proposal not found, raises exception.
3. Creates mission with status `'approved'` and `started_at = now()`.
4. Inserts steps from `template.steps` array:
   - Each step gets `kind`, `params` from template
   - Status set to `'queued'`
   - Executor defaults to `'openclaw'` if not specified
5. Returns new mission ID.

**Step Creation Logic:**
```sql
insert into ops_mission_steps (mission_id, kind, params, status, executor)
select
  v_mission_id,
  step->>'kind',
  coalesce(step->'params','{}'::jsonb),
  'queued',
  coalesce(step->>'executor', 'openclaw')
from jsonb_array_elements(coalesce(v_template->'steps','[]'::jsonb)) as step
where step ? 'kind';
```

**Usage Example:**
```sql
select ops_create_mission_from_proposal('123e4567-e89b-12d3-a456-426614174000');
-- Returns: new mission UUID
```

**Error Conditions:**
- Proposal not found (raises exception)
- Invalid template structure
- Database errors

**Related Functions:**
- `ops_create_proposal_and_maybe_autoapprove()` - Calls this function when auto-approving

**File Reference:** `./supabase/migrations/0002_ops_functions.sql:114-139`

---

### ops_maybe_finalize_mission

**Purpose:** Checks mission step statuses and updates mission status to succeeded or failed.

**Signature:**
```sql
ops_maybe_finalize_mission(p_mission_id uuid)
returns void
```

**Parameters:**
- `p_mission_id` (uuid, required) - ID of the mission to finalize

**Returns:** void

**Behavior:**
1. Counts failed and remaining (queued or running) steps.
2. If any steps failed:
   - Updates mission status to `'failed'`
   - Sets `completed_at = now()`
3. If no steps remaining:
   - Updates mission status to `'succeeded'`
   - Sets `completed_at = now()`
4. If steps still running/queued, does nothing.

**Finalization Logic:**
```sql
if v_failed > 0 then
  -- Mission failed
  update ops_missions set status = 'failed', completed_at = now()
  where id = p_mission_id;
elsif v_remaining = 0 then
  -- Mission succeeded
  update ops_missions set status = 'succeeded', completed_at = now()
  where id = p_mission_id;
end if;
```

**Usage Example:**
```sql
select ops_maybe_finalize_mission('123e4567-e89b-12d3-a456-426614174000');
-- Updates mission status in-place
```

**When to Call:**
- After a step succeeds (check if all steps complete)
- After a step fails (check if any steps remain)
- After recovering stale steps

**Error Conditions:**
- Mission not found (no error raised, no update performed)
- Database errors

**Related Functions:**
- `ops_recover_stale_steps()` - Calls this after recovering steps
- `ops_recover_expired_leases()` - Calls this after failing steps

**File Reference:** `./supabase/migrations/0002_ops_functions.sql:205-226`

---

### ops_recover_stale_steps

**Purpose:** Identifies and fails steps that have been running too long without progress (stale detection).

**Signature:**
```sql
ops_recover_stale_steps(p_threshold_minutes integer)
returns table (recovered_steps integer)
```

**Parameters:**
- `p_threshold_minutes` (integer, required) - Minutes of inactivity before considering a step stale

**Returns:** Setof record with columns:
- `recovered_steps` (integer) - Number of steps marked as failed

**Behavior:**
1. Identifies steps with status `'running'` where `reserved_at < now() - threshold_minutes`.
2. Updates identified steps to status `'failed'`.
3. Sets `last_error = 'Stale: no progress within threshold'`.
4. For each affected mission, calls `ops_maybe_finalize_mission()` to update mission status.
5. Returns count of recovered steps.

**Stale Definition:**
A step is stale if:
- Status is `'running'`
- `reserved_at` is not null
- `reserved_at` is older than `p_threshold_minutes`

**Usage Example:**
```sql
select * from ops_recover_stale_steps(30);
-- Fails steps that have been running for 30+ minutes without progress
```

**Integration:** Called by heartbeat API endpoint with threshold from `OPS_STALE_STEP_MINUTES` environment variable.

**Error Conditions:**
- Database errors

**Related Functions:**
- `ops_maybe_finalize_mission()` - Called for each affected mission

**File Reference:** `./supabase/migrations/0002_ops_functions.sql:228-257`

---

### ops_recover_expired_leases

**Purpose:** Reclaims steps with expired leases, re-queueing them for retry or marking as failed if max retries exceeded.

**Signature:**
```sql
ops_recover_expired_leases()
returns table (requeued_steps integer, failed_steps integer)
```

**Parameters:** None

**Returns:** Setof record with columns:
- `requeued_steps` (integer) - Number of steps re-queued for retry
- `failed_steps` (integer) - Number of steps marked as permanently failed

**Behavior:**
1. Identifies steps with status `'running'` where `lease_expires_at < now()`.
2. For each expired step:
   - Increments `failure_count`
   - Sets `last_error = 'Lease expired'`
   - Clears `reserved_at` and `lease_expires_at`
   - If `failure_count >= max_retries`: sets status to `'failed'`
   - Otherwise: sets status to `'queued'` for retry
3. For each mission with newly failed steps, calls `ops_maybe_finalize_mission()`.
4. Returns counts of re-queued and failed steps.

**Lease Expiration Logic:**
```sql
status = case
  when max_retries is not null and (failure_count + 1) >= max_retries then 'failed'
  else 'queued'
end
```

**Usage Example:**
```sql
select * from ops_recover_expired_leases();
-- Returns: (requeued_steps=5, failed_steps=1)
```

**Integration:** Called by heartbeat API endpoint.

**Error Conditions:**
- Database errors

**Related Functions:**
- `ops_maybe_finalize_mission()` - Called for missions with failed steps
- `ops_claim_next_step()` - Used to claim re-queued steps

**File Reference:** `./supabase/migrations/0003_ops_deadletters_and_leases.sql:20-63`

---

### ops_claim_next_step

**Purpose:** Atomically claims the next queued step for execution, implementing the worker lease mechanism.

**Signature:**
```sql
ops_claim_next_step(p_lease_minutes integer)
returns setof ops_mission_steps
```

**Parameters:**
- `p_lease_minutes` (integer, required) - Lease duration in minutes

**Returns:** Setof `ops_mission_steps` records (typically 0 or 1 row)

**Behavior:**
1. Selects the oldest step with status `'queued'`.
2. Uses `FOR UPDATE SKIP LOCKED` to handle concurrent workers safely.
3. Updates the step:
   - Sets status to `'running'`
   - Sets `reserved_at = now()`
   - Sets `lease_expires_at = now() + lease_minutes`
4. Returns the claimed step.
5. If no steps available, returns empty set.

**Concurrency Safety:**
The `SKIP LOCKED` clause ensures that multiple workers can call this function simultaneously without conflicts. Each worker gets a different step, or nothing if no steps are available.

**Usage Example:**
```sql
select * from ops_claim_next_step(5);
-- Returns: single ops_mission_steps record with 5-minute lease
-- or empty set if no steps available
```

**Worker Integration:**
```javascript
const { data: step } = await supabase.rpc('ops_claim_next_step', {
  p_lease_minutes: 5
});

if (step && step.length > 0) {
  // Execute the step
  await executeStep(step[0]);

  // Update with result
  await supabase.from('ops_mission_steps').update({
    status: 'succeeded',
    result: executionResult
  }).eq('id', step[0].id);
}
```

**Error Conditions:**
- Database errors
- Invalid lease duration

**Related Functions:**
- `ops_recover_expired_leases()` - Reclaims expired leases from this function

**File Reference:** `./supabase/migrations/0002_ops_functions.sql:259-287`

---

### ops_extract_step_kinds

**Purpose:** Helper function that extracts unique step kinds from a proposal template.

**Signature:**
```sql
ops_extract_step_kinds(p_template jsonb)
returns text[]
```

**Parameters:**
- `p_template` (jsonb, required) - Proposal template containing steps array

**Returns:** Array of text - Unique step kind names

**Behavior:**
1. Extracts `steps` array from template (defaults to empty array if missing)
2. Iterates through steps, extracting `kind` field
3. Returns array of unique step kinds

**Usage Example:**
```sql
select ops_extract_step_kinds('{
  "steps": [
    {"kind": "openclaw", "params": {}},
    {"kind": "wreckit", "params": {}},
    {"kind": "openclaw", "params": {}}
  ]
}'::jsonb);
-- Returns: {openclaw, wreckit}
```

**Error Conditions:**
- Invalid jsonb structure (returns null)

**Related Functions:**
- `ops_is_auto_approvable()` - Uses this to check step kinds against whitelist

**File Reference:** `./supabase/migrations/0002_ops_functions.sql:38-45`

---

### ops_set_updated_at

**Purpose:** Trigger function that automatically updates `updated_at` timestamp on row modification.

**Signature:**
```sql
ops_set_updated_at()
returns trigger
```

**Usage:** Attached as a BEFORE UPDATE trigger on tables with `updated_at` columns.

**Behavior:**
```sql
begin
  new.updated_at = now();
  return new;
end;
```

**Attached To:**
- `ops_missions` - Trigger: `ops_missions_set_updated_at`
- `ops_mission_steps` - Trigger: `ops_mission_steps_set_updated_at`
- `ops_agent_reactions` - Trigger: `ops_agent_reactions_set_updated_at`

**Usage Example:**
No direct calls needed. Trigger fires automatically on UPDATE.

```sql
update ops_missions set status = 'running' where id = '...';
-- updated_at is automatically set to now()
```

**File Reference:** `./supabase/migrations/0002_ops_functions.sql:4-36`

---

## 🌐 HTTP Endpoints

### POST /api/ops/heartbeat

**Purpose:** Main control loop endpoint that triggers event processing, reaction evaluation, stale step recovery, and lease expiration.

**URL:** `https://your-vercel-app.vercel.app/api/ops/heartbeat`

**Method:** `POST`

**Authentication:** Bearer token via `Authorization` header

**Request Headers:**
```
Authorization: Bearer YOUR_OPS_API_KEY
Content-Type: application/json
```

**Request Body:**
```json
{}
```
Empty object. No parameters required.

**Response (200 OK):**
```json
{
  "ok": true,
  "triggerResult": {
    "events": 25,
    "queued": 5
  },
  "reactionResult": {
    "processed": 5,
    "created": 3
  },
  "learningResult": {
    "promoted": 0
  },
  "leaseResult": {
    "requeued_steps": 2,
    "failed_steps": 0
  },
  "staleResult": {
    "recovered": 0
  }
}
```

**Response Fields:**
- `ok` (boolean) - Always `true` for successful execution
- `triggerResult` (object) - Event trigger evaluation results
  - `events` (integer) - Number of events processed
  - `queued` (integer) - Number of reactions queued
- `reactionResult` (object) - Reaction queue processing results
  - `processed` (integer) - Number of reactions processed
  - `created` (integer) - Number of proposals created
- `learningResult` (object) - Insight promotion results (currently unused)
  - `promoted` (integer) - Number of insights promoted (always 0)
- `leaseResult` (object) - Expired lease recovery results
  - `requeued_steps` (integer) - Number of steps re-queued
  - `failed_steps` (integer) - Number of steps permanently failed
- `staleResult` (object) - Stale step recovery results
  - `recovered` (integer) - Number of stale steps recovered

**Error Responses:**

**401 Unauthorized:**
```json
{
  "error": "Unauthorized"
}
```
Caused by missing or invalid `Authorization` header.

**405 Method Not Allowed:**
```json
{
  "error": "Method not allowed"
}
```
Caused by using HTTP method other than POST.

**500 Internal Server Error:**
```json
{
  "error": "Error message here"
}
```
Caused by database errors, network issues, or unexpected exceptions.

**Side Effects:**
1. Evaluates unprocessed events against reaction matrix patterns
2. Queues matching reactions
3. Processes reaction queue to create proposals
4. Recovers expired step leases
5. Recovers stale steps
6. Publishes "agent:thought" events for observability

**Rate Limiting:** None enforced at API level. Supabase may have its own limits.

**Recommended Usage:**
Call via cron every 5 minutes:
```bash
*/5 * * * * curl -X POST https://your-vercel-app.vercel.app/api/ops/heartbeat \
  -H "Authorization: Bearer $OPS_API_KEY"
```

**Implementation Details:**
- Batch size controlled by `OPS_EVENT_BATCH_SIZE` env var (default: 25)
- Reaction batch size controlled by `OPS_REACTION_BATCH_SIZE` env var (default: 25)
- Stale threshold controlled by `OPS_STALE_STEP_MINUTES` env var (default: 30)

**File Reference:** `./vercel/pages/api/ops/heartbeat.ts`

---

## 📊 Database Table Reference

### ops_policy

**Purpose:** Stores system-wide policy configuration as key-value pairs.

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `key` | text | PRIMARY KEY | Policy key (e.g., 'reaction_matrix', 'auto_approve') |
| `value` | jsonb | NOT NULL, DEFAULT '{}' | Policy configuration data |
| `version` | integer | NOT NULL, DEFAULT 1 | Policy version number for tracking changes |
| `updated_at` | timestamptz | NOT NULL, DEFAULT now() | Last update timestamp |

**Policy Keys:**
- `reaction_matrix` - Pattern matching rules for event→proposal flow
- `auto_approve` - Auto-approval configuration
- `proposal_caps` - Quota and limit configuration
- `worker_policy` - Worker execution constraints
- `agent_roles` - Agent role configurations

**Indexes:** None (primary key lookup)

**Example Data:**
```sql
insert into ops_policy (key, value) values
  ('auto_approve', '{"enabled": true, "allowed_step_kinds": ["noop"]}'::jsonb),
  ('proposal_caps', '{"daily_limit": 100}'::jsonb);
```

**File Reference:** `./supabase/migrations/0001_ops_schema.sql:23-28`

---

### ops_mission_proposals

**Purpose:** Stores mission proposals awaiting or having received approval.

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique proposal identifier |
| `dedupe_key` | text | UNIQUE | Optional deduplication key to prevent duplicate proposals |
| `source` | text | NOT NULL, CHECK in ('api','trigger','reaction','manual') | Source of the proposal |
| `status` | ops_proposal_status | NOT NULL | Proposal status: pending, approved, rejected, auto_approved |
| `template` | jsonb | NOT NULL | Mission template with steps array |
| `reason` | text | | Reason for rejection or notes |
| `policy_snapshot` | jsonb | | Snapshot of policy at proposal creation time |
| `approved_at` | timestamptz | | Timestamp when proposal was approved |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | Proposal creation timestamp |

**Status Enum Values:**
- `pending` - Awaiting manual approval
- `approved` - Manually approved
- `rejected` - Rejected by policy gate or manual action
- `auto_approved` - Automatically approved by policy

**Indexes:**
- `ops_mission_proposals_status_idx` on `(status, created_at desc)`

**Example Data:**
```sql
insert into ops_mission_proposals (source, status, template) values
  ('manual', 'pending', '{
    "title": "Deploy to production",
    "risk_level": "high",
    "steps": [
      {"kind": "wreckit", "params": {"command": "deploy"}}
    ]
  }'::jsonb);
```

**File Reference:** `./supabase/migrations/0001_ops_schema.sql:35-49`

---

### ops_missions

**Purpose:** Stores approved missions and their execution status.

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique mission identifier |
| `proposal_id` | uuid | FOREIGN KEY → ops_mission_proposals(id) ON DELETE SET NULL | Source proposal |
| `status` | ops_mission_status | NOT NULL | Mission status: approved, running, succeeded, failed |
| `policy_snapshot` | jsonb | | Policy snapshot at mission creation |
| `started_at` | timestamptz | | Mission start timestamp |
| `completed_at` | timestamptz | | Mission completion timestamp |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | Mission creation timestamp |
| `updated_at` | timestamptz | NOT NULL, DEFAULT now() | Last update timestamp (auto-updated by trigger) |

**Status Enum Values:**
- `approved` - Mission created, not yet started
- `running` - Mission is executing steps
- `succeeded` - All steps completed successfully
- `failed` - One or more steps failed

**Indexes:**
- `ops_missions_status_idx` on `(status, created_at desc)`

**Triggers:**
- `ops_missions_set_updated_at` - Auto-updates `updated_at` on row update

**Example Data:**
```sql
insert into ops_missions (proposal_id, status, started_at) values
  ('123e4567-e89b-12d3-a456-426614174000', 'approved', now());
```

**File Reference:** `./supabase/migrations/0001_ops_schema.sql:51-61`

---

### ops_mission_steps

**Purpose:** Stores individual execution steps within a mission.

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique step identifier |
| `mission_id` | uuid | FOREIGN KEY → ops_missions(id) ON DELETE CASCADE, NOT NULL | Parent mission |
| `kind` | text | NOT NULL | Step kind (executor type: openclaw, wreckit, radar, minion, noop) |
| `params` | jsonb | NOT NULL, DEFAULT '{}' | Step parameters passed to executor |
| `status` | ops_step_status | NOT NULL | Step status: queued, running, succeeded, failed |
| `executor` | text | | Executor override (defaults to 'openclaw') |
| `reserved_at` | timestamptz | | Lease start time (when step was claimed) |
| `lease_expires_at` | timestamptz | | Lease expiration time |
| `failure_count` | integer | NOT NULL, DEFAULT 0 | Number of failed attempts |
| `max_retries` | integer | | Maximum retry attempts (null = unlimited) |
| `last_error` | text | | Last error message |
| `result` | jsonb | | Step execution result |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | Step creation timestamp |
| `updated_at` | timestamptz | NOT NULL, DEFAULT now() | Last update timestamp (auto-updated by trigger) |

**Status Enum Values:**
- `queued` - Waiting to be claimed by worker
- `running` - Currently executing (leased)
- `succeeded` - Completed successfully
- `failed` - Failed after all retries exhausted

**Indexes:**
- `ops_mission_steps_status_idx` on `(status, reserved_at)`
- `ops_mission_steps_mission_idx` on `(mission_id, status)`

**Triggers:**
- `ops_mission_steps_set_updated_at` - Auto-updates `updated_at` on row update

**Example Data:**
```sql
insert into ops_mission_steps (mission_id, kind, params, status, executor) values
  ('123e4567-e89b-12d3-a456-426614174000', 'openclaw',
   '{"agent": "sage", "prompt": "Analyze this"}'::jsonb,
   'queued', 'openclaw');
```

**File Reference:** `./supabase/migrations/0001_ops_schema.sql:63-81`

---

### ops_agent_events

**Purpose:** Stores raw events that trigger reactions and proposals.

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique event identifier |
| `dedupe_key` | text | UNIQUE | Optional deduplication key |
| `type` | text | NOT NULL | Event type (e.g., 'agent:thought', 'step:succeeded') |
| `data` | jsonb | NOT NULL | Event payload |
| `mission_id` | uuid | FOREIGN KEY → ops_missions(id) ON DELETE SET NULL | Related mission (optional) |
| `processed_at` | timestamptz | | When event was processed by heartbeat |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | Event creation timestamp |

**Common Event Types:**
- `agent:thought` - Agent publishes a thought/update
- `step:succeeded` - A step completed successfully
- `step:failed` - A step failed
- `mission:complete` - A mission completed
- Custom types for domain-specific events

**Indexes:**
- `ops_agent_events_type_idx` on `(type, processed_at)`

**Example Data:**
```sql
insert into ops_agent_events (type, data) values
  ('agent:thought', '{"agent": "Sage", "thought": "Processing request..."}'::jsonb),
  ('deploy:requested', '{"service": "api", "environment": "prod"}'::jsonb);
```

**File Reference:** `./supabase/migrations/0001_ops_schema.sql:88-99`

---

### ops_agent_reactions

**Purpose:** Queue for reactions generated by event pattern matching.

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique reaction identifier |
| `event_id` | uuid | FOREIGN KEY → ops_agent_events(id) ON DELETE CASCADE | Source event |
| `status` | text | NOT NULL, DEFAULT 'queued', CHECK in ('queued','processing','done','failed') | Processing status |
| `payload` | jsonb | NOT NULL, DEFAULT '{}' | Reaction payload (pattern_id, proposal_template, etc.) |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | Reaction creation timestamp |
| `updated_at` | timestamptz | NOT NULL, DEFAULT now() | Last update timestamp (auto-updated by trigger) |

**Status Values:**
- `queued` - Awaiting processing
- `processing` - Currently being processed (not currently used)
- `done` - Successfully processed, proposal created
- `failed` - Processing failed

**Payload Structure:**
```json
{
  "pattern_id": "pattern-123",
  "event_type": "deploy:requested",
  "proposal_template": {...},
  "proposal_source": "trigger",
  "dedupe_key": "unique-key-123",
  "error": "error message if failed",
  "result": {...}
}
```

**Indexes:**
- `ops_agent_reactions_status_idx` on `(status, created_at)`
- `ops_agent_reactions_pattern_idx` on `(payload->>'pattern_id')`

**Triggers:**
- `ops_agent_reactions_set_updated_at` - Auto-updates `updated_at` on row update

**Example Data:**
```sql
insert into ops_agent_reactions (event_id, status, payload) values
  ('event-uuid', 'queued', '{
    "pattern_id": "deploy-trigger",
    "proposal_template": {"title": "Deploy", "steps": [...]}
  }'::jsonb);
```

**File Reference:** `./supabase/migrations/0001_ops_schema.sql:101-111`

---

### ops_action_runs

**Purpose:** Observability table for tracking executor runs.

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique run identifier |
| `run_id` | text | UNIQUE | External run identifier (e.g., from executor) |
| `step_id` | uuid | FOREIGN KEY → ops_mission_steps(id) ON DELETE SET NULL | Related step |
| `executor` | text | | Executor type (openclaw, wreckit, etc.) |
| `status` | ops_action_run_status | NOT NULL | Run status: started, succeeded, failed |
| `started_at` | timestamptz | NOT NULL, DEFAULT now() | Run start timestamp |
| `completed_at` | timestamptz | | Run completion timestamp |
| `meta` | jsonb | | Additional metadata |
| `error` | text | | Error message if failed |

**Status Enum Values:**
- `started` - Executor started
- `succeeded` - Executor completed successfully
- `failed` - Executor failed

**Indexes:**
- `ops_action_runs_step_idx` on `(step_id, started_at desc)`

**Example Data:**
```sql
insert into ops_action_runs (step_id, executor, status) values
  ('step-uuid', 'openclaw', 'started');
```

**File Reference:** `./supabase/migrations/0001_ops_schema.sql:113-127`

---

### ops_step_dead_letters

**Purpose:** Permanently failed steps preserved for inspection and debugging.

**Columns:**
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique dead letter identifier |
| `step_id` | uuid | FOREIGN KEY → ops_mission_steps(id) ON DELETE SET NULL | Original step ID |
| `mission_id` | uuid | FOREIGN KEY → ops_missions(id) ON DELETE SET NULL | Original mission ID |
| `kind` | text | | Step kind (executor type) |
| `params` | jsonb | | Step parameters |
| `executor` | text | | Executor type |
| `failure_count` | integer | | Number of failed attempts |
| `last_error` | text | | Final error message |
| `result` | jsonb | | Partial result if any |
| `created_at` | timestamptz | NOT NULL, DEFAULT now() | Dead letter creation timestamp |

**Purpose:** When a step exceeds `max_retries`, it may be copied here before deletion for audit and debugging.

**Indexes:**
- `ops_step_dead_letters_mission_idx` on `(mission_id, created_at desc)`

**Example Data:**
```sql
insert into ops_step_dead_letters (mission_id, kind, params, failure_count, last_error) values
  ('mission-uuid', 'wreckit', '{"command": "deploy"}'::jsonb, 3, 'Connection timeout');
```

**File Reference:** `./supabase/migrations/0003_ops_deadletters_and_leases.sql:2-15`

---

## 📦 Event Schema Reference

### ops_agent_events

**Table:** `ops_agent_events`

**Purpose:** Raw event stream for triggers, reactions, and observability.

**Event Structure:**
```json
{
  "id": "uuid",
  "dedupe_key": "optional-unique-key",
  "type": "event-type-string",
  "data": {
    "any": "fields",
    "tags": ["tag1", "tag2"],
    "source": "event-source"
  },
  "mission_id": "uuid-or-null",
  "processed_at": "iso-timestamp-or-null",
  "created_at": "iso-timestamp"
}
```

**Common Event Types:**

**agent:thought**
```json
{
  "type": "agent:thought",
  "data": {
    "agent": "Sage",
    "thought": "Analyzing deployment requirements...",
    "tags": ["agent", "status"]
  }
}
```

**step:succeeded**
```json
{
  "type": "step:succeeded",
  "data": {
    "step_id": "uuid",
    "kind": "openclaw",
    "result": {...}
  },
  "mission_id": "uuid"
}
```

**step:failed**
```json
{
  "type": "step:failed",
  "data": {
    "step_id": "uuid",
    "kind": "wreckit",
    "error": "Connection timeout",
    "failure_count": 3
  },
  "mission_id": "uuid"
}
```

**Custom Events:**
You can define custom event types for your domain:
```json
{
  "type": "deploy:requested",
  "data": {
    "service": "api",
    "environment": "production",
    "source": "manual",
    "tags": ["deploy", "production"]
  }
}
```

**Event Matching in Reaction Matrix:**
Events are matched against reaction matrix patterns using:
- `type` or `event_type` field matching
- `data.tags` array inclusion matching
- `data.source` exact matching

**File Reference:** `./supabase/migrations/0001_ops_schema.sql:88-99`

---

## 📝 Proposal Template Schema

### Template Structure

**Purpose:** Defines the structure of mission proposals submitted to `ops_create_proposal_and_maybe_autoapprove()`.

**Schema:**
```json
{
  "title": "Human-readable proposal title",
  "description": "Optional detailed description",
  "risk_level": "low|medium|high",
  "steps": [
    {
      "kind": "executor-type",
      "executor": "optional-executor-override",
      "params": {
        "executor-specific": "parameters"
      }
    }
  ]
}
```

**Required Fields:**
- `steps` - Array of step objects (must have at least one step)

**Optional Fields:**
- `title` - Human-readable title
- `description` - Detailed description
- `risk_level` - Risk classification (used for policy decisions)

**Step Object:**

```json
{
  "kind": "executor-type",
  "executor": "optional-override",
  "params": {}
}
```

**Step Fields:**
- `kind` (required) - Executor type: `openclaw`, `wreckit`, `radar`, `minion`, `noop`, or custom
- `executor` (optional) - Override executor (defaults to `kind` value or `'openclaw'`)
- `params` (optional) - Executor-specific parameters (defaults to `{}`)

**Validation Rules:**
1. `steps` must be an array
2. Each step must have a `kind` field
3. `params` defaults to empty object if omitted
4. `executor` defaults to step's `kind` or `'openclaw'` if omitted

**Examples:**

**Simple Noop Step:**
```json
{
  "title": "Test Proposal",
  "steps": [
    {
      "kind": "noop",
      "params": {}
    }
  ]
}
```

**Multi-Step Deployment:**
```json
{
  "title": "Deploy API to Production",
  "risk_level": "high",
  "steps": [
    {
      "kind": "openclaw",
      "params": {
        "agent": "Scout",
        "prompt": "Verify deployment prerequisites"
      }
    },
    {
      "kind": "wreckit",
      "params": {
        "command": "deploy",
        "id": "api-production"
      }
    },
    {
      "kind": "openclaw",
      "params": {
        "agent": "Observer",
        "prompt": "Verify deployment health"
      }
    }
  ]
}
```

**Radar Integration:**
```json
{
  "title": "Track New Feature Demand",
  "steps": [
    {
      "kind": "radar",
      "params": {
        "action": "create",
        "title": "User Authentication",
        "stage": "Watching"
      }
    }
  ]
}
```

**Template Rendering in Reaction Matrix:**

When a reaction pattern matches an event, the proposal template is rendered using Mustache-like syntax:

**Pattern:**
```json
{
  "event_type": "deploy:requested",
  "template": {
    "title": "Deploy {{event.data.service}}",
    "steps": [
      {
        "kind": "wreckit",
        "params": {
          "command": "deploy",
          "id": "{{event.data.service}}"
        }
      }
    ]
  }
}
```

**Event:**
```json
{
  "type": "deploy:requested",
  "data": {
    "service": "api",
    "environment": "production"
  }
}
```

**Rendered Template:**
```json
{
  "title": "Deploy api",
  "steps": [
    {
      "kind": "wreckit",
      "params": {
        "command": "deploy",
        "id": "api"
      }
    }
  ]
}
```

**Rendering Syntax:**
- `{{field}}` - Simple field reference
- `{{object.field}}` - Nested field reference
- `{{array.0.field}}` - Array index access
- Unmatched variables remain as-is (fallback to original template)

**File Reference:** Used by `./vercel/pages/api/ops/heartbeat.ts` renderTemplate function

---

## ❌ Error Reference

### Database Errors

**SQL Error Codes:**
- `23505` - Unique constraint violation (duplicate `dedupe_key`)
- `23503` - Foreign key constraint violation
- `23514` - Check constraint violation (invalid enum value)
- `22001` - String data too long

**Common Errors:**

**Duplicate Proposal:**
```
ERROR: duplicate key value violates unique constraint "ops_mission_proposals_dedupe_key_idx"
DETAIL: Key (dedupe_key)=(proposal-123) already exists.
```
**Solution:** Use existing proposal ID from response, or generate unique dedupe key.

**Invalid Status:**
```
ERROR: value for domain ops_proposal_status violates check constraint
```
**Solution:** Use valid enum values: `'pending'`, `'approved'`, `'rejected'`, `'auto_approved'`

**Proposal Not Found:**
```
ERROR: Proposal 123e4567-e89b-12d3-a456-426614174000 not found
```
**Solution:** Verify proposal ID exists and was not deleted.

---

### HTTP Errors

**401 Unauthorized**
```json
{
  "error": "Unauthorized"
}
```
**Cause:** Missing or invalid `Authorization` header
**Solution:** Include `Authorization: Bearer YOUR_OPS_API_KEY` header

**405 Method Not Allowed**
```json
{
  "error": "Method not allowed"
}
```
**Cause:** Using GET instead of POST
**Solution:** Use POST method for `/api/ops/heartbeat`

**500 Internal Server Error**
```json
{
  "error": "Connection refused",
  "error": "Timed out",
  "error": "Unknown error"
}
```
**Cause:** Database connection issues, network errors, or unexpected exceptions
**Solution:** Check Vercel logs, verify Supabase credentials, check network connectivity

---

### RPC Function Errors

**ops_create_proposal_and_maybe_autoapprove:**

**Error:** Invalid source
```
ERROR: value for domain ops_mission_proposals violates check constraint "ops_mission_proposals_source_check"
```
**Solution:** Use valid source: `'api'`, `'trigger'`, `'reaction'`, `'manual'`

**Error:** Daily cap reached
**Status:** `'rejected'`
**Reason:** `'Daily proposal cap reached'`
**Solution:** Wait for daily reset or increase `proposal_caps.daily_limit` policy

**ops_claim_next_step:**

**Error:** No steps available
**Returns:** Empty set (not an error)
**Solution:** No actionable steps in queue. This is normal.

**ops_recover_stale_steps:**

**Error:** Invalid threshold
**Cause:** Negative or null `p_threshold_minutes`
**Solution:** Use positive integer value

---

### Application Error Codes

**OPS_001: Reaction Pattern Matching Failed**
- Symptom: Events not creating proposals
- Diagnosis: Check pattern syntax in reaction_matrix policy
- Solution: Verify event_type, tags, and source fields match actual events

**OPS_002: Template Rendering Failed**
- Symptom: Proposal templates not rendering correctly
- Diagnosis: Check Mustache syntax in template
- Solution: Ensure all `{{event.data.field}}` paths exist

**OPS_003: Auto-Approval Rejected**
- Symptom: Safe proposals not auto-approving
- Diagnosis: Check auto_approve policy configuration
- Solution: Verify `enabled: true` and step kinds in `allowed_step_kinds`

**OPS_004: Lease Expiration Loop**
- Symptom: Steps repeatedly expiring and re-queueing
- Diagnosis: Worker crash or long-running executor
- Solution: Increase lease duration, fix worker issues, or increase max_retries

**OPS_005: Stale Step Detection**
- Symptom: Steps stuck in 'running' status
- Diagnosis: Worker not updating step status
- Solution: Check worker logs, verify executor is functioning

**OPS_006: Proposal Cap Blocking**
- Symptom: All proposals rejected with cap error
- Diagnosis: Daily limit reached
- Solution: Increase limit or wait for reset

**OPS_007: Mission Finalization Stuck**
- Symptom: Mission not finalizing after steps complete
- Diagnosis: `ops_maybe_finalize_mission()` not being called
- Solution: Ensure worker calls finalization after each step

**OPS_008: Dedupe Key Collision**
- Symptom: New proposals returning existing proposal ID
- Diagnosis: Intentional deduplication or key collision
- Solution: Use unique dedupe keys or omit for no deduplication

**OPS_009: Reaction Queue Buildup**
- Symptom: Reactions accumulating in 'queued' status
- Diagnosis: Heartbeat not processing reaction queue
- Solution: Verify heartbeat is running and calling processReactionQueue

**OPS_010: Event Processing Backlog**
- Symptom: Events with `processed_at = null` accumulating
- Diagnosis: Heartbeat not running or reaction matrix empty
- Solution: Verify heartbeat cron job, check reaction_matrix policy has patterns

---

## 🔗 Cross-References

**Related Documentation:**
- [Architecture Deep Dive](./ARCHITECTURE_DEEP_DIVE.md) - System architecture and data flow
- [Policy Configuration](./POLICY_CONFIGURATION.md) - Policy system details
- [Operations Runbook](./OPERATIONS_RUNBOOK.md) - Troubleshooting and monitoring
- [Integration Guides](./INTEGRATION_GUIDES.md) - Executor implementations

**Source Files:**
- `./supabase/migrations/0001_ops_schema.sql` - Database schema definitions
- `./supabase/migrations/0002_ops_functions.sql` - RPC function implementations
- `./supabase/migrations/0003_ops_deadletters_and_leases.sql` - Dead letter and lease recovery
- `./vercel/pages/api/ops/heartbeat.ts` - HTTP endpoint implementation

---

## 📝 Changelog

### Version 1.0.0 (2025-01-21)
- Initial API reference documentation
- All 10 RPC functions documented
- All 8 database tables documented
- HTTP endpoint documented
- Event and proposal template schemas documented
- Error reference created

---

**Document Version:** 1.0.0
**Last Updated:** 2025-01-21
**Maintained By:** VoxYZ Operations Team
