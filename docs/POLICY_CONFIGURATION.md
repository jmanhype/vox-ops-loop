# VoxYZ Ops-Loop Policy Configuration Reference

## 📋 Overview

The Ops-Loop system uses a **policy-based governance model** where all behavior is controlled through configuration stored in the `ops_policy` table. Policies control which events trigger proposals, which proposals are auto-approved, execution safeguards, and agent behavior.

This reference documents all 5 policy keys, their structure, validation rules, and provides example policies for different operational scenarios.

---

## 🎯 Policy System Architecture

### Policy Storage

Policies are stored in the `ops_policy` table:

```sql
CREATE TABLE ops_policy (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Policy Keys

| Key | Purpose | Scope |
|-----|---------|-------|
| `reaction_matrix` | Event → Proposal pattern matching | Trigger evaluation |
| `auto_approve` | Automatic proposal approval | Proposal gating |
| `proposal_caps` | Quota and rate limiting | Proposal gating |
| `worker_policy` | Execution safeguards | Step execution |
| `agent_roles` | Agent configuration | Agent instantiation |

### Policy Evaluation Order

1. **Event ingestion** → Check `reaction_matrix` for matching patterns
2. **Reaction creation** → Generate proposal from matched pattern template
3. **Proposal gating** → Check `proposal_caps` → Check `auto_approve`
4. **Mission execution** → Apply `worker_policy` during step execution
5. **Agent invocation** → Use `agent_roles` configuration

### Policy Versioning

Policies are **not versioned in the database** (only `updated_at` is tracked). For production use, consider:
- External policy version control (git)
- Policy change audit logging
- Policy snapshot at proposal creation time (stored in `ops_mission_proposals.policy_snapshot`)

---

## 🔄 Reaction Matrix Policy

### Purpose

The **reaction matrix** defines pattern-matching rules that transform events into proposal templates. It's the primary mechanism for autonomous behavior.

### Structure

```json
{
  "patterns": [
    {
      "id": "unique-identifier",
      "event_type": "event:type" | ["event:type1", "event:type2"] | "*",
      "tags": ["tag1", "tag2"],
      "source": "event-source",
      "probability": 0.5,
      "cooldown_minutes": 60,
      "dedupe_key": "custom-dedupe-key",
      "template": {
        "title": "Proposal title with {{event.data.field}}",
        "risk_level": "low",
        "steps": [...]
      }
    }
  ]
}
```

### Pattern Matching Syntax

#### event_type

- **String match**: `"event:type"` - matches exact event type
- **Array match**: `["type1", "type2"]` - matches any type in array
- **Wildcard**: `"*"` - matches all event types
- **Legacy field**: `type` is aliased to `event_type`

**Example:**
```json
{
  "event_type": "radar:watching",
  "matches": "radar:watching events only"
}
```

#### tags

- **Array of required tags**: All tags must be present in `event.data.tags`
- **Empty array**: No tag filtering
- **Optional field**: If omitted, no tag filtering applied

**Example:**
```json
{
  "tags": ["urgent", "security"],
  "matches": "Events with BOTH urgent AND security tags"
}
```

#### source

- **String match**: Must match `event.data.source` exactly
- **Optional field**: If omitted, any source is accepted

**Example:**
```json
{
  "source": "github",
  "matches": "Events from GitHub only"
}
```

### Probability and Cooldown

#### probability

- **Range**: 0.0 to 1.0
- **Behavior**: If specified, pattern only matches with this probability
- **Default**: 1.0 (always match if pattern matches)
- **Use case**: Rate limiting, stochastic sampling, A/B testing

**Example:**
```json
{
  "probability": 0.1,
  "matches": "10% of matching events"
}
```

#### cooldown_minutes

- **Range**: Any positive integer
- **Behavior**: Prevents pattern from matching if it matched within this time window
- **Check mechanism**: Queries `ops_agent_reactions` table for recent matches with same `pattern_id`
- **Default**: No cooldown
- **Use case**: Prevent spam, rate limiting, avoiding repetitive actions

**Example:**
```json
{
  "id": "daily-summary",
  "cooldown_minutes": 1440,
  "matches": "At most once per day"
}
```

### Template Rendering

Templates use **Mustache-like syntax** with `{{event.field.path}}` placeholders.

**Supported paths:**
- `{{event.id}}` - Event UUID
- `{{event.type}}` - Event type
- `{{event.data.field}}` - Any field in event.data
- `{{event.data.nested.field}}` - Nested field access

**Example:**
```json
{
  "template": {
    "title": "Process {{event.data.source}} signal from {{event.data.region}}",
    "steps": [{
      "kind": "openclaw",
      "params": {
        "agent": "sage",
        "prompt": "Analyze this signal: {{event.data.summary}}"
      }
    }]
  }
}
```

**Rendering logic** (from `heartbeat.ts`):
```typescript
function renderTemplate(template: any, context: any): any {
  if (typeof template === 'string') {
    return template.replace(/\{\{(.*?)\}\}/g, (match, path) => {
      const parts = path.trim().split('.');
      let val = context;
      for (const part of parts) {
        val = val?.[part];
      }
      return val !== undefined ? val : match;
    });
  }
  // Recursive rendering for objects and arrays
  // ...
}
```

### dedupe_key

- **Purpose**: Prevent duplicate proposals for same event
- **Default**: `{{event.id}}:{{pattern.id}}`
- **Custom**: Specify custom deduplication logic
- **Storage**: Stored in `ops_agent_reactions.payload.dedupe_key`

**Example:**
```json
{
  "dedupe_key": "{{event.data.repository_url}}:pr-{{event.data.pr_number}}",
  "prevents": "Multiple proposals for same PR"
}
```

### Complete Pattern Example

```json
{
  "patterns": [
    {
      "id": "radar-watching-scout",
      "event_type": "radar:watching",
      "tags": ["frontend"],
      "source": "demand_radar",
      "probability": 0.8,
      "cooldown_minutes": 30,
      "template": {
        "title": "Investigate {{event.data.title}}",
        "risk_level": "low",
        "steps": [
          {
            "kind": "openclaw",
            "executor": "openclaw",
            "params": {
              "agent": "scout",
              "prompt": "Research {{event.data.title}} and provide technical summary.",
              "thinking": true
            }
          },
          {
            "kind": "openclaw",
            "executor": "openclaw",
            "params": {
              "agent": "sage",
              "prompt": "Review the research on {{event.data.title}} and recommend action.",
              "thinking": true
            }
          }
        ]
      }
    }
  ]
}
```

### Reaction Matrix Evaluation

**Implementation**: `heartbeat.ts` → `evaluateTriggers()`

**Process:**
1. Fetch `reaction_matrix` policy from `ops_policy` table
2. Fetch unprocessed events (batch size: `OPS_EVENT_BATCH_SIZE`, default 25)
3. For each event, check each pattern:
   - Match `event_type` (exact, array, or wildcard)
   - Match all `tags` (if specified)
   - Match `source` (if specified)
   - Pass `probability` check (if specified)
   - Check `cooldown_minutes` (if specified)
   - If all checks pass: create reaction
4. Mark event as processed only if it matched at least one pattern

### Troubleshooting Reaction Matrix

**Pattern not matching:**
```sql
-- Check if pattern exists
SELECT value->'patterns' FROM ops_policy WHERE key = 'reaction_matrix';

-- Check unprocessed events
SELECT * FROM ops_agent_events WHERE processed_at IS NULL ORDER BY created_at DESC LIMIT 10;

-- Check recent reactions
SELECT * FROM ops_agent_reactions ORDER BY created_at DESC LIMIT 10;
```

**Cooldown blocking:**
```sql
-- Check recent pattern matches
SELECT * FROM ops_agent_reactions
WHERE payload->>'pattern_id' = 'your-pattern-id'
ORDER BY created_at DESC;
```

**Template rendering issues:**
- Verify field paths exist in `event.data`
- Check JSON syntax in template
- Test rendering manually with actual event data

---

## ✅ Auto-Approval Policy

### Purpose

The **auto-approval policy** controls which proposals are automatically converted to missions without human intervention.

### Structure

```json
{
  "enabled": true | false,
  "allowed_step_kinds": ["kind1", "kind2"]
}
```

### Fields

#### enabled

- **Type**: Boolean
- **Default**: false
- **Behavior**: Master switch for auto-approval
- **Security**: When false, NO proposals are auto-approved regardless of other settings

**Example:**
```json
{
  "enabled": true
}
```

#### allowed_step_kinds

- **Type**: Array of strings
- **Default**: null (no restrictions)
- **Behavior**: Whitelist of step kinds that can be auto-approved
- **Logic**: ALL step kinds in proposal must be in this list
- **Use case**: Restrict auto-approval to safe operations only

**Example:**
```json
{
  "enabled": true,
  "allowed_step_kinds": ["noop", "openclaw:scout", "openclaw:sage"]
}
```

### Auto-Approval Logic

**Implementation**: `0002_ops_functions.sql` → `ops_is_auto_approvable()`

**Decision tree:**
1. If `auto_approve` policy is missing → **DENY**
2. If `enabled` is false or null → **DENY**
3. If `allowed_step_kinds` is null → **APPROVE** (no restrictions)
4. Extract all step kinds from proposal template
5. If any step kind is NOT in `allowed_step_kinds` → **DENY**
6. Otherwise → **APPROVE**

**SQL implementation:**
```sql
create or replace function ops_is_auto_approvable(p_template jsonb)
returns boolean language plpgsql as $$
declare
  v_policy jsonb;
  v_enabled boolean;
  v_allowed jsonb;
  v_step_kinds text[];
  v_kind text;
begin
  select value into v_policy from ops_policy where key = 'auto_approve';

  if v_policy is null then
    return false; -- No policy = deny
  end if;

  v_enabled := coalesce((v_policy->>'enabled')::boolean, false);
  if v_enabled is false then
    return false; -- Disabled = deny
  end if;

  v_allowed := v_policy->'allowed_step_kinds';
  if v_allowed is null then
    return true; -- Enabled, no restrictions
  end if;

  v_step_kinds := ops_extract_step_kinds(p_template);
  if v_step_kinds is null or array_length(v_step_kinds, 1) is null then
    return false; -- No steps = deny
  end if;

  foreach v_kind in array v_step_kinds loop
    if not (v_allowed ? v_kind) then
      return false; -- Any unallowed kind = deny
    end if;
  end loop;

  return true; -- All checks passed
end;
$$;
```

### Step Kind Extraction

**Implementation**: `0002_ops_functions.sql` → `ops_extract_step_kinds()`

```sql
create or replace function ops_extract_step_kinds(p_template jsonb)
returns text[] language sql as $$
  select array_agg(distinct step->>'kind')
  from jsonb_array_elements(coalesce(p_template->'steps','[]'::jsonb)) as step
  where step ? 'kind';
$$;
```

### Example Policies

#### Low-Risk Testing Policy

Auto-approve safe operations only:

```json
{
  "enabled": true,
  "allowed_step_kinds": ["noop", "openclaw:scout"]
}
```

**Rationale**: Scout and noop are read-only operations. Safe for automation.

#### Development Environment Policy

Auto-approve all operations in dev:

```json
{
  "enabled": true
}
```

**Rationale**: Development environment, no restrictions needed.

#### Production Policy

Disable auto-approval entirely:

```json
{
  "enabled": false
}
```

**Rationale**: All proposals require human review in production.

#### Selective Automation Policy

Auto-approve specific agent workflows:

```json
{
  "enabled": true,
  "allowed_step_kinds": [
    "noop",
    "openclaw:scout",
    "openclaw:sage",
    "openclaw:quill",
    "radar:update"
  ]
}
```

**Rationale**: Read-only and radar updates are safe. Deployment and write operations require approval.

### Testing Auto-Approval

```sql
-- Check current policy
SELECT * FROM ops_policy WHERE key = 'auto_approve';

-- Test auto-approval logic
SELECT ops_is_auto_approvable('{
  "title": "Test",
  "risk_level": "low",
  "steps": [{"kind": "noop", "params": {}}]
}'::jsonb);

-- Should return true if noop is allowed
```

---

## 📊 Proposal Caps Policy

### Purpose

The **proposal caps policy** implements quota-based rate limiting to prevent proposal flooding and control system load.

### Structure

```json
{
  "daily_limit": 100,
  "per_source": {
    "github": 10,
    "radar": 50,
    "manual": 5
  }
}
```

### Fields

#### daily_limit

- **Type**: Integer
- **Default**: null (no limit)
- **Behavior**: Maximum number of proposals per day (globally)
- **Time window**: Calendar day (midnight to midnight, UTC)
- **Counting**: All proposals except 'rejected' status

**Example:**
```json
{
  "daily_limit": 100
}
```

#### per_source

- **Type**: Object mapping source → limit
- **Default**: null (no per-source limits)
- **Behavior**: Separate quotas for each event source
- **Implementation**: NOT CURRENTLY IMPLEMENTED in `ops_gate_proposal()`

**Example:**
```json
{
  "per_source": {
    "github": 10,
    "radar": 50
  }
}
```

**Note**: The `per_source` feature is defined in the policy structure but not yet implemented in the SQL function. Extend `ops_gate_proposal()` to add this feature.

### Proposal Gating Logic

**Implementation**: `0002_ops_functions.sql` → `ops_gate_proposal()`

**Decision tree:**
1. Fetch `proposal_caps` policy
2. If policy is null → **APPROVE** (no limits)
3. Check `daily_limit`:
   - Count proposals created today (UTC)
   - If count >= limit → **DENY** with reason "Daily proposal cap reached"
   - Otherwise → **APPROVE**

**SQL implementation:**
```sql
create or replace function ops_gate_proposal(p_template jsonb)
returns table (ok boolean, reason text) language plpgsql as $$
declare
  v_caps jsonb;
  v_daily_limit integer;
  v_count integer;
begin
  select value into v_caps from ops_policy where key = 'proposal_caps';

  if v_caps is not null then
    v_daily_limit := nullif((v_caps->>'daily_limit')::integer, 0);
    if v_daily_limit is not null then
      select count(*) into v_count
      from ops_mission_proposals
      where created_at >= date_trunc('day', now());

      if v_count >= v_daily_limit then
        ok := false;
        reason := 'Daily proposal cap reached';
        return next;
        return;
      end if;
    end if;
  end if;

  ok := true;
  reason := null;
  return next;
end;
$$;
```

### Monitoring Proposal Caps

```sql
-- Check current proposal count today
SELECT
  count(*) as total_proposals,
  count(*) filter (where status = 'pending') as pending,
  count(*) filter (where status = 'approved') as approved,
  count(*) filter (where status = 'auto_approved') as auto_approved,
  count(*) filter (where status = 'rejected') as rejected
FROM ops_mission_proposals
WHERE created_at >= date_trunc('day', now());

-- Check proposals by source
SELECT
  source,
  count(*) as count
FROM ops_mission_proposals
WHERE created_at >= date_trunc('day', now())
GROUP BY source
ORDER BY count DESC;

-- Check current policy
SELECT * FROM ops_policy WHERE key = 'proposal_caps';
```

### Example Policies

#### Development Policy

No limits:

```json
{
  "daily_limit": null
}
```

#### Conservative Production Policy

Strict limit:

```json
{
  "daily_limit": 50
}
```

#### High-Volume Testing Policy

Higher limit for load testing:

```json
{
  "daily_limit": 1000
}
```

### Extending Proposal Caps

To add **per-source limits**, extend `ops_gate_proposal()`:

```sql
-- Add after daily_limit check
v_source_limit integer;
v_source text;

-- Get source from template or default
v_source := p_template->>'source';

-- Check per-source limit
if v_caps ? 'per_source' and (v_caps->'per_source') ? v_source then
  v_source_limit := ((v_caps->'per_source')->>v_source)::integer;
  select count(*) into v_count
  from ops_mission_proposals
  where source = v_source
    and created_at >= date_trunc('day', now());

  if v_count >= v_source_limit then
    ok := false;
    reason := 'Source-specific proposal cap reached for ' || v_source;
    return next;
    return;
  end if;
end if;
```

---

## 🛡️ Worker Policy

### Purpose

The **worker policy** defines execution safeguards for the local worker process, controlling retry behavior, step timeouts, and executor restrictions.

### Structure

```json
{
  "max_retries": 3,
  "lease_minutes": 10,
  "allowed_subcommands": ["agent", "think"],
  "blocked_executors": ["wreckit"]
}
```

### Fields

#### max_retries

- **Type**: Integer
- **Default**: 2 (from `OPS_WORKER_MAX_RETRIES` env var)
- **Behavior**: Maximum retry attempts before step is marked as permanently failed
- **Priority**: Step-level `max_retries` > Worker policy > Environment variable

**Implementation** (from `worker.mjs`):
```javascript
const policy = await getPolicyValue('worker_policy', {});
const maxRetries = step.max_retries ?? policy?.max_retries ?? Number(process.env.OPS_WORKER_MAX_RETRIES || 2);
```

**Example:**
```json
{
  "max_retries": 3
}
```

#### lease_minutes

- **Type**: Integer
- **Default**: 10 (from `OPS_STEP_LEASE_MINUTES` env var)
- **Behavior**: Duration of step execution lease
- **Timeout**: Steps exceeding lease are marked as stale and recovered
- **Implementation**: Used in `ops_claim_next_step()` function

**Example:**
```json
{
  "lease_minutes": 15
}
```

#### allowed_subcommands

- **Type**: Array of strings
- **Default**: null (no restrictions)
- **Behavior**: Whitelist of OpenClaw subcommands that can be executed
- **Implementation**: NOT CURRENTLY IMPLEMENTED in executor code
- **Use case**: Restrict OpenClaw to safe operations only

**Example:**
```json
{
  "allowed_subcommands": ["agent", "think"]
}
```

**Note**: This feature is defined in policy structure but not enforced. Extend OpenClaw executor to add validation.

#### blocked_executors

- **Type**: Array of strings
- **Default**: null (no blocking)
- **Behavior**: Blacklist of executors that cannot be used
- **Implementation**: NOT CURRENTLY IMPLEMENTED in worker code
- **Use case**: Prevent dangerous executors (e.g., wreckit in production)

**Example:**
```json
{
  "blocked_executors": ["wreckit", "shell"]
}
```

**Note**: This feature is defined in policy structure but not enforced. Extend worker to add validation.

### Retry Logic

**Implementation**: `worker.mjs`

**Process:**
1. Execute step via executor
2. If error occurs:
   - Increment `failure_count`
   - Check if `failure_count < max_retries`
   - If yes: Reset step to 'queued' status, clear lease
   - If no: Mark step as 'failed', create dead letter
3. If success:
   - Mark step as 'succeeded'
   - Emit success event
   - Finalize mission if all steps complete

**Retry behavior:**
```javascript
if (!errorMsg) {
  // Success path
  await supabase.from('ops_mission_steps').update({
    status: 'succeeded',
    result,
    updated_at: new Date().toISOString(),
  }).eq('id', step.id);
  return;
}

const nextFailureCount = (step.failure_count || 0) + 1;
const shouldRetry = nextFailureCount < maxRetries;

if (shouldRetry) {
  // Retry path
  await supabase.from('ops_mission_steps').update({
    status: 'queued',
    failure_count: nextFailureCount,
    last_error: errorMsg,
    reserved_at: null,
    lease_expires_at: null,
  }).eq('id', step.id);
  return;
}

// Permanent failure path
await supabase.from('ops_mission_steps').update({
  status: 'failed',
  failure_count: nextFailureCount,
  last_error: errorMsg,
}).eq('id', step.id);

// Create dead letter
await supabase.from('ops_step_dead_letters').insert({...});
```

### Dead Letter Creation

When a step fails permanently (exhausts retries), it's moved to the **dead letter queue** for manual inspection:

```sql
INSERT INTO ops_step_dead_letters (
  step_id,
  mission_id,
  kind,
  params,
  executor,
  failure_count,
  last_error,
  result
)
SELECT
  id,
  mission_id,
  kind,
  params,
  executor,
  failure_count,
  last_error,
  result
FROM ops_mission_steps
WHERE id = $1;
```

### Example Policies

#### Development Policy

Lenient retries, long lease:

```json
{
  "max_retries": 5,
  "lease_minutes": 30
}
```

#### Production Policy

Strict retries, short lease:

```json
{
  "max_retries": 2,
  "lease_minutes": 10
}
```

#### High-Security Policy

Restrict dangerous operations:

```json
{
  "max_retries": 1,
  "lease_minutes": 5,
  "allowed_subcommands": ["agent", "think"],
  "blocked_executors": ["wreckit", "shell"]
}
```

**Note**: `allowed_subcommands` and `blocked_executors` require implementation in executor code.

---

## 🤖 Agent Roles Policy

### Purpose

The **agent roles policy** defines configuration for all 6 agent types (Minion, Sage, Scout, Quill, Xalt, Observer), including their instructions, model selection, tool permissions, and behavior.

### Structure

```json
{
  "minion": {
    "instructions": "...",
    "model": "gpt-4o",
    "tools": ["web_search", "web_fetch"],
    "temperature": 0.7
  },
  "sage": {
    "instructions": "...",
    "model": "gpt-4o",
    "tools": ["web_search", "web_fetch"],
    "temperature": 0.7
  },
  "scout": {
    "instructions": "...",
    "model": "gpt-4o",
    "tools": ["web_search", "web_fetch"],
    "temperature": 0.7
  },
  "quill": {
    "instructions": "...",
    "model": "gpt-4o",
    "tools": ["web_search", "web_fetch", "file_write"],
    "temperature": 0.7
  },
  "xalt": {
    "instructions": "...",
    "model": "gpt-4o",
    "tools": ["web_search", "web_fetch", "file_write", "shell_execute"],
    "temperature": 0.3
  },
  "observer": {
    "instructions": "...",
    "model": "gpt-4o",
    "tools": [],
    "temperature": 0.5
  }
}
```

### Agent Fields

Each agent configuration supports the following fields:

#### instructions

- **Type**: String
- **Required**: Yes
- **Purpose**: System prompt defining agent's role, behavior, and responsibilities
- **Format**: Natural language instructions

**Example (Sage):**
```json
{
  "instructions": "You are the Sage. Your role is to analyze information, provide strategic feedback, and recommend actions. When you receive data from the Scout, evaluate its importance and suggest the best next steps for the Minion or Quill. Emit a 'sage:recommend' event with your final recommendation."
}
```

#### model

- **Type**: String
- **Required**: Yes
- **Purpose**: OpenAI model to use for this agent
- **Options**: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`
- **Recommendation**: Use `gpt-4o` for complex agents (Sage, Xalt), `gpt-4o-mini` for simple agents (Minion, Scout)

**Example:**
```json
{
  "model": "gpt-4o"
}
```

#### tools

- **Type**: Array of strings
- **Required**: No
- **Purpose**: Whitelist of tools this agent can use
- **Options**: `web_search`, `web_fetch`, `file_write`, `file_read`, `shell_execute`, etc.
- **Security**: Restrict tools based on agent's risk level

**Example:**
```json
{
  "tools": ["web_search", "web_fetch"]
}
```

#### temperature

- **Type**: Float (0.0 to 2.0)
- **Required**: No
- **Purpose**: Controls randomness in model responses
- **Guidelines**:
  - 0.0 - 0.3: Deterministic, factual (Observer, Xalt)
  - 0.4 - 0.7: Balanced (Sage, Quill)
  - 0.8 - 1.0: Creative (Minion, Scout)

**Example:**
```json
{
  "temperature": 0.7
}
```

### Agent Role Specifications

#### Minion

**Purpose**: General task execution, following instructions precisely

**Configuration:**
```json
{
  "minion": {
    "instructions": "You are the Minion. Execute tasks as instructed. Follow the provided steps precisely. Report results accurately.",
    "model": "gpt-4o-mini",
    "tools": ["file_write", "file_read", "shell_execute"],
    "temperature": 0.5
  }
}
```

**Use cases**: File operations, shell commands, simple task execution

#### Sage

**Purpose**: Strategic analysis, recommendation, decision support

**Configuration** (from `configure_sage.js`):
```json
{
  "sage": {
    "instructions": "You are the Sage. Your role is to analyze information, provide strategic feedback, and recommend actions. When you receive data from the Scout, evaluate its importance and suggest the best next steps for the Minion or Quill. Emit a 'sage:recommend' event with your final recommendation.",
    "model": "gpt-4o",
    "tools": ["web_search", "web_fetch"],
    "temperature": 0.7
  }
}
```

**Use cases**: Strategic analysis, decision support, research evaluation

#### Scout

**Purpose**: Information gathering, research, reconnaissance

**Configuration:**
```json
{
  "scout": {
    "instructions": "You are the Scout. Your mission is to gather information from external sources. Search the web, fetch documentation, and provide comprehensive summaries. Be thorough but concise.",
    "model": "gpt-4o-mini",
    "tools": ["web_search", "web_fetch"],
    "temperature": 0.6
  }
}
```

**Use cases**: Web research, documentation gathering, competitive analysis

#### Quill

**Purpose**: Content creation, documentation, writing

**Configuration:**
```json
{
  "quill": {
    "instructions": "You are the Quill. Create high-quality content including documentation, articles, and summaries. Write clearly, accurately, and with proper structure. Use markdown formatting.",
    "model": "gpt-4o",
    "tools": ["web_search", "web_fetch", "file_write"],
    "temperature": 0.8
  }
}
```

**Use cases**: Documentation, blog posts, summaries, content generation

#### Xalt

**Purpose**: Code execution, deployment, high-risk operations

**Configuration:**
```json
{
  "xalt": {
    "instructions": "You are Xalt. Execute code changes and deployments with extreme caution. Verify all changes before applying. Follow security best practices. Never execute未经reviewed code.",
    "model": "gpt-4o",
    "tools": ["file_write", "file_read", "shell_execute", "git"],
    "temperature": 0.3
  }
}
```

**Use cases**: Code deployment, infrastructure changes, risky operations

**Security**: Xalt should be heavily restricted and typically require manual approval

#### Observer

**Purpose**: Supervision, monitoring, audit logging

**Configuration:**
```json
{
  "observer": {
    "instructions": "You are the Observer. Monitor system operations, detect anomalies, and report issues. Maintain audit logs. Do not execute any actions directly, only observe and report.",
    "model": "gpt-4o",
    "tools": [],
    "temperature": 0.2
  }
}
```

**Use cases**: System monitoring, anomaly detection, audit logging

### Agent Configuration Management

**Updating agent configuration** (example from `configure_sage.js`):

```javascript
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function configureAgent() {
  await client.connect();

  const res = await client.query(
    `SELECT value FROM ops_policy WHERE key = 'agent_roles'`
  );
  let roles = res.rows[0]?.value || {};

  roles.sage = {
    ...roles.sage,
    instructions: "You are the Sage. Your role is...",
    tools: ["web_search", "web_fetch"],
    model: "gpt-4o"
  };

  await client.query(
    `UPDATE ops_policy SET value = $1, updated_at = now() WHERE key = 'agent_roles'`,
    [JSON.stringify(roles)]
  );

  await client.end();
}
```

### Model Selection Guidelines

| Agent | Recommended Model | Rationale |
|-------|------------------|-----------|
| Minion | gpt-4o-mini | Simple tasks, cost efficiency |
| Sage | gpt-4o | Complex reasoning, worth cost |
| Scout | gpt-4o-mini | Research is straightforward |
| Quill | gpt-4o | Writing quality benefits from larger model |
| Xalt | gpt-4o | Safety-critical, need best reasoning |
| Observer | gpt-4o | Anomaly detection benefits from intelligence |

### Tool Permissions by Agent

| Tool | Minion | Sage | Scout | Quill | Xalt | Observer |
|------|--------|------|-------|-------|------|----------|
| web_search | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| web_fetch | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| file_write | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| file_read | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| shell_execute | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| git | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |

**Principle**: Least privilege - agents only have tools required for their role.

---

## 🧪 Policy Testing and Validation

### Testing Reaction Matrix

**Step 1: Insert test event**
```sql
INSERT INTO ops_agent_events (type, data, dedupe_key)
VALUES (
  'test:event',
  '{"source": "test", "tags": ["test"], "message": "Hello"}',
  'test-event-1'
);
```

**Step 2: Run heartbeat**
```bash
curl -X POST https://your-vercel-app.vercel.app/api/ops/heartbeat \
  -H "Authorization: Bearer $OPS_API_KEY"
```

**Step 3: Check for reactions**
```sql
SELECT * FROM ops_agent_reactions ORDER BY created_at DESC LIMIT 5;
```

**Step 4: Verify proposal creation**
```sql
SELECT * FROM ops_mission_proposals ORDER BY created_at DESC LIMIT 5;
```

### Testing Auto-Approval

**Step 1: Create test policy**
```sql
INSERT INTO ops_policy (key, value)
VALUES (
  'auto_approve',
  '{"enabled": true, "allowed_step_kinds": ["noop"]}'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

**Step 2: Create test proposal**
```sql
SELECT * FROM ops_create_proposal_and_maybe_autoapprove(
  'test-auto-approve',
  'test',
  '{
    "title": "Test Auto-Approval",
    "risk_level": "low",
    "steps": [{"kind": "noop", "params": {}}]
  }'::jsonb
);
```

**Step 3: Verify auto-approval**
```sql
-- Should be "auto_approved"
SELECT status, approved_at FROM ops_mission_proposals WHERE dedupe_key = 'test-auto-approve';

-- Should have mission created
SELECT * FROM ops_missions WHERE proposal_id IN (
  SELECT id FROM ops_mission_proposals WHERE dedupe_key = 'test-auto-approve'
);
```

### Testing Proposal Caps

**Step 1: Set low daily limit**
```sql
INSERT INTO ops_policy (key, value)
VALUES ('proposal_caps', '{"daily_limit": 5}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

**Step 2: Check current count**
```sql
SELECT count(*) FROM ops_mission_proposals
WHERE created_at >= date_trunc('day', now());
```

**Step 3: Test cap enforcement**
```sql
SELECT * FROM ops_gate_proposal('{"title": "Test"}'::jsonb);
```

**Expected**: Returns `(ok=false, reason='Daily proposal cap reached')` when limit exceeded

### Testing Worker Policy

**Step 1: Set retry policy**
```sql
INSERT INTO ops_policy (key, value)
VALUES ('worker_policy', '{"max_retries": 2, "lease_minutes": 10}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

**Step 2: Create failing mission**
```sql
-- Create proposal with invalid step
SELECT ops_create_proposal_and_maybe_autoapprove(
  'test-failures',
  'test',
  '{
    "title": "Test Failures",
    "risk_level": "low",
    "steps": [{"kind": "invalid", "params": {}}]
  }'::jsonb
);
```

**Step 3: Run worker and observe retries**
```bash
npm run worker
```

**Step 4: Check failure count**
```sql
SELECT id, failure_count, last_error, status
FROM ops_mission_steps
WHERE mission_id IN (SELECT id FROM ops_missions)
ORDER BY updated_at DESC;
```

**Step 5: Check dead letter**
```sql
SELECT * FROM ops_step_dead_letters ORDER BY created_at DESC LIMIT 5;
```

---

## 📚 Example Policy Library

### Policy 1: Development Environment

**Profile**: High automation, permissive, verbose logging

```json
{
  "reaction_matrix": {
    "patterns": [
      {
        "id": "dev-all-events",
        "event_type": "*",
        "template": {
          "title": "Process {{event.type}}",
          "risk_level": "low",
          "steps": [{"kind": "noop", "params": {}}]
        }
      }
    ]
  },
  "auto_approve": {
    "enabled": true
  },
  "proposal_caps": {
    "daily_limit": null
  },
  "worker_policy": {
    "max_retries": 5,
    "lease_minutes": 30
  },
  "agent_roles": {
    "minion": {
      "instructions": "Dev mode: Execute freely.",
      "model": "gpt-4o-mini",
      "tools": ["file_write", "file_read", "shell_execute"],
      "temperature": 0.5
    },
    "sage": {
      "instructions": "Dev mode: Analyze freely.",
      "model": "gpt-4o",
      "tools": ["web_search", "web_fetch"],
      "temperature": 0.7
    },
    "scout": {
      "instructions": "Dev mode: Research freely.",
      "model": "gpt-4o-mini",
      "tools": ["web_search", "web_fetch"],
      "temperature": 0.6
    },
    "quill": {
      "instructions": "Dev mode: Write freely.",
      "model": "gpt-4o",
      "tools": ["web_search", "web_fetch", "file_write"],
      "temperature": 0.8
    },
    "xalt": {
      "instructions": "Dev mode: Execute code changes.",
      "model": "gpt-4o",
      "tools": ["file_write", "file_read", "shell_execute", "git"],
      "temperature": 0.3
    },
    "observer": {
      "instructions": "Dev mode: Monitor everything.",
      "model": "gpt-4o",
      "tools": [],
      "temperature": 0.2
    }
  }
}
```

### Policy 2: Production Hardened

**Profile**: Low automation, restrictive, manual approval required

```json
{
  "reaction_matrix": {
    "patterns": [
      {
        "id": "prod-radat-scout",
        "event_type": "radar:watching",
        "tags": ["validated"],
        "cooldown_minutes": 60,
        "template": {
          "title": "Investigate {{event.data.title}}",
          "risk_level": "low",
          "steps": [
            {
              "kind": "openclaw",
              "params": {"agent": "scout", "prompt": "Research {{event.data.title}}", "thinking": true}
            }
          ]
        }
      }
    ]
  },
  "auto_approve": {
    "enabled": false
  },
  "proposal_caps": {
    "daily_limit": 50
  },
  "worker_policy": {
    "max_retries": 2,
    "lease_minutes": 10
  },
  "agent_roles": {
    "minion": {
      "instructions": "Production mode: Execute only approved tasks.",
      "model": "gpt-4o-mini",
      "tools": ["file_write", "file_read"],
      "temperature": 0.3
    },
    "sage": {
      "instructions": "Production mode: Provide conservative recommendations.",
      "model": "gpt-4o",
      "tools": ["web_search", "web_fetch"],
      "temperature": 0.5
    },
    "scout": {
      "instructions": "Production mode: Gather information carefully.",
      "model": "gpt-4o-mini",
      "tools": ["web_search", "web_fetch"],
      "temperature": 0.4
    },
    "quill": {
      "instructions": "Production mode: Create accurate documentation.",
      "model": "gpt-4o",
      "tools": ["web_search", "web_fetch", "file_write"],
      "temperature": 0.6
    },
    "xalt": {
      "instructions": "Production mode: Execute deployments ONLY after manual approval.",
      "model": "gpt-4o",
      "tools": ["git"],
      "temperature": 0.1
    },
    "observer": {
      "instructions": "Production mode: Monitor and report ALL anomalies.",
      "model": "gpt-4o",
      "tools": [],
      "temperature": 0.1
    }
  }
}
```

### Policy 3: Testing/CI

**Profile**: No automation, manual triggers only, verbose logging

```json
{
  "reaction_matrix": {
    "patterns": []
  },
  "auto_approve": {
    "enabled": false
  },
  "proposal_caps": {
    "daily_limit": 1000
  },
  "worker_policy": {
    "max_retries": 0,
    "lease_minutes": 5
  },
  "agent_roles": {
    "minion": {
      "instructions": "Test mode: Execute test steps.",
      "model": "gpt-4o-mini",
      "tools": [],
      "temperature": 0.0
    },
    "sage": {
      "instructions": "Test mode: Provide test analysis.",
      "model": "gpt-4o-mini",
      "tools": [],
      "temperature": 0.0
    },
    "scout": {
      "instructions": "Test mode: Mock research.",
      "model": "gpt-4o-mini",
      "tools": [],
      "temperature": 0.0
    },
    "quill": {
      "instructions": "Test mode: Mock writing.",
      "model": "gpt-4o-mini",
      "tools": [],
      "temperature": 0.0
    },
    "xalt": {
      "instructions": "Test mode: Mock deployments.",
      "model": "gpt-4o-mini",
      "tools": [],
      "temperature": 0.0
    },
    "observer": {
      "instructions": "Test mode: Mock monitoring.",
      "model": "gpt-4o-mini",
      "tools": [],
      "temperature": 0.0
    }
  }
}
```

---

## 🔧 Policy Management Operations

### Inserting/Updating Policy

```sql
-- Insert new policy
INSERT INTO ops_policy (key, value)
VALUES ('your_policy_key', '{"setting": "value"}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Update existing policy
UPDATE ops_policy
SET value = '{"new": "value"}', updated_at = now()
WHERE key = 'your_policy_key';
```

### Retrieving Policy

```sql
-- Get specific policy
SELECT * FROM ops_policy WHERE key = 'your_policy_key';

-- Get all policies
SELECT * FROM ops_policy ORDER BY key;
```

### Deleting Policy

```sql
DELETE FROM ops_policy WHERE key = 'your_policy_key';
```

### Auditing Policy Changes

```sql
-- Policy table doesn't track history by default
-- Consider adding audit table:

CREATE TABLE ops_policy_audit (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  changed_at TIMESTAMPTZ DEFAULT now(),
  changed_by TEXT
);

-- Trigger to log changes
CREATE OR REPLACE FUNCTION log_policy_changes()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ops_policy_audit (key, old_value, new_value)
  VALUES (OLD.key, OLD.value, NEW.value);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER policy_audit_trigger
AFTER UPDATE ON ops_policy
FOR EACH ROW EXECUTE FUNCTION log_policy_changes();
```

---

## 🔍 Troubleshooting Policies

### Reaction Matrix Not Working

**Symptoms**: Events not creating proposals

**Diagnosis:**
```sql
-- 1. Check policy exists
SELECT * FROM ops_policy WHERE key = 'reaction_matrix';

-- 2. Check unprocessed events
SELECT * FROM ops_agent_events WHERE processed_at IS NULL ORDER BY created_at DESC LIMIT 10;

-- 3. Check pattern syntax
SELECT value->'patterns' FROM ops_policy WHERE key = 'reaction_matrix';

-- 4. Check recent reactions
SELECT * FROM ops_agent_reactions ORDER BY created_at DESC LIMIT 10;
```

**Solutions:**
- Verify pattern syntax (event_type, tags, source)
- Check event data matches pattern expectations
- Verify cooldown isn't blocking (check recent reactions with same pattern_id)
- Check probability isn't too low

### Auto-Approval Not Working

**Symptoms**: Proposals stuck in 'pending' status

**Diagnosis:**
```sql
-- 1. Check policy
SELECT * FROM ops_policy WHERE key = 'auto_approve';

-- 2. Test auto-approval logic
SELECT ops_is_auto_approvable('{"steps": [{"kind": "noop"}]}'::jsonb);

-- 3. Check proposal status
SELECT status, approved_at, template FROM ops_mission_proposals ORDER BY created_at DESC LIMIT 10;
```

**Solutions:**
- Verify `enabled` is true
- Check step kinds are in `allowed_step_kinds`
- Verify proposal template structure is valid

### Proposal Caps Blocking

**Symptoms**: Proposals rejected with "Daily proposal cap reached"

**Diagnosis:**
```sql
-- 1. Check current count
SELECT count(*) FROM ops_mission_proposals WHERE created_at >= date_trunc('day', now());

-- 2. Check policy
SELECT * FROM ops_policy WHERE key = 'proposal_caps';

-- 3. Check rejected proposals
SELECT * FROM ops_mission_proposals WHERE status = 'rejected' ORDER BY created_at DESC LIMIT 10;
```

**Solutions:**
- Increase daily_limit
- Wait for day rollover (UTC midnight)
- Delete old test proposals if needed

### Worker Retries Exhausting

**Symptoms**: Steps failing permanently, dead letters accumulating

**Diagnosis:**
```sql
-- 1. Check worker policy
SELECT * FROM ops_policy WHERE key = 'worker_policy';

-- 2. Check failing steps
SELECT * FROM ops_mission_steps WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 10;

-- 3. Check dead letters
SELECT * FROM ops_step_dead_letters ORDER BY created_at DESC LIMIT 10;

-- 4. Check error messages
SELECT kind, last_error, count(*) FROM ops_mission_steps WHERE status = 'failed' GROUP BY kind, last_error;
```

**Solutions:**
- Increase max_retries
- Investigate root cause of failures
- Update agent configuration
- Fix executor implementation

---

## 📖 Additional Resources

### Related Documentation

- [System Overview](SYSTEM_OVERVIEW.md) - High-level system introduction
- [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md) - Technical architecture details
- [Agent Guide](AGENT_GUIDE.md) - Agent role specifications
- [Developer Onboarding](DEVELOPER_ONBOARDING.md) - Setup and development procedures
- [Operations Runbook](OPERATIONS_RUNBOOK.md) - Deployment and operations
- [API Reference](API_REFERENCE.md) - Function signatures and endpoints
- [Integration Guides](INTEGRATION_GUIDES.md) - Executor documentation

### Database Schema

- [ops_policy table](ARCHITECTURE_DEEP_DIVE.md#database-schema)
- [ops_mission_proposals table](ARCHITECTURE_DEEP_DIVE.md#database-schema)
- [SQL migrations](../supabase/migrations/0002_ops_functions.sql)

### Code References

- Reaction evaluation: [`vercel/pages/api/ops/heartbeat.ts`](../vercel/pages/api/ops/heartbeat.ts)
- Worker execution: [`local/src/worker.mjs`](../local/src/worker.mjs)
- Policy functions: [`supabase/migrations/0002_ops_functions.sql`](../supabase/migrations/0002_ops_functions.sql)
- Agent configuration: [`local/configure_sage.js`](../local/configure_sage.js)
