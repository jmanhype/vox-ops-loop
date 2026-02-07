# VoxYZ Ops-Loop Developer Onboarding Guide

## 🎯 Overview

This guide provides comprehensive instructions for developers joining the VoxYZ Ops-Loop project. You'll learn how to set up your local development environment, run the system, debug issues, and perform common development tasks.

**Target Audience:** Software developers working on the Ops-Loop system
**Prerequisites:** Basic familiarity with Node.js, PostgreSQL, and command-line tools
**Estimated Setup Time:** 30-45 minutes

---

## 📋 Table of Contents

1. [Prerequisites and Setup](#prerequisites-and-setup)
2. [Database Setup](#database-setup)
3. [Running the System Locally](#running-the-system-locally)
4. [Testing Workflows](#testing-workflows)
5. [Debugging Techniques](#debugging-techniques)
6. [Common Development Tasks](#common-development-tasks)
7. [Development Workflow](#development-workflow)

---

## 🛠️ Prerequisites and Setup

### System Requirements

**Required Software:**
- **Node.js:** Version 18.x or higher (the project uses ES modules)
- **npm:** Version 9.x or higher (comes with Node.js)
- **PostgreSQL Client:** `psql` command-line tool (optional, for direct database access)
- **Git:** For version control

**Recommended Tools:**
- **IDE:** VS Code with PostgreSQL extension
- **API Client:** Postman or Insomnia for testing API endpoints
- **Database UI:** Supabase Table Editor or pgAdmin

### Account Setup

**1. Supabase Account**
- Sign up at https://supabase.com
- Create a new project (or use existing)
- Navigate to Project Settings → API to get credentials
- Note your `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

**2. Vercel Account (for control plane deployment)**
- Sign up at https://vercel.com
- Connect your Git repository
- Set up environment variables in Vercel project settings

### Local Environment Setup

**Step 1: Clone the Repository**

```bash
git clone <repository-url>
cd ops-loop
```

**Step 2: Install Local Dependencies**

```bash
cd local
npm install
```

This installs:
- `@supabase/supabase-js` - Supabase client library
- `dotenv` - Environment variable management
- `node-fetch` - HTTP requests
- `pg` - PostgreSQL client

**Step 3: Configure Environment Variables**

```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:

```bash
# Required: Supabase connection
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Optional: Worker tuning (defaults shown)
OPS_STEP_LEASE_MINUTES=10        # How long a worker can lease a step
OPS_STALE_STEP_MINUTES=30        # After how many minutes a step is considered stale
OPS_WORKER_MAX_RETRIES=2         # How many times to retry failed steps
OPS_EVENT_BATCH_SIZE=25          # Events processed per heartbeat cycle
OPS_REACTION_BATCH_SIZE=25       # Reactions processed per heartbeat cycle

# Optional: OpenClaw executor configuration
OPENCLAW_BIN=openclaw            # Path to openclaw binary
OPENCLAW_TIMEOUT_MS=600000       # 10 minutes
```

**Important Security Notes:**
- Never commit `.env` to version control
- Use `SUPABASE_SERVICE_ROLE_KEY` (not anon key) for local development
- Keep your service role key secret - it bypasses RLS policies

**Step 4: Verify Database Connection**

```bash
node -e "
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
client.from('ops_agent_events').select('count').then(({data, error}) => {
  if (error) console.error('Connection failed:', error.message);
  else console.log('✅ Database connection successful');
});
"
```

---

## 🗄️ Database Setup

### Running Migrations

The Ops-Loop uses Supabase PostgreSQL with migrations stored in `./supabase/migrations/`.

**Option 1: Via Supabase Dashboard (Recommended for Initial Setup)**

1. Open your Supabase project dashboard
2. Navigate to SQL Editor
3. For each migration file:
   - Open the file: `supabase/migrations/0001_ops_schema.sql`
   - Copy contents to SQL Editor
   - Click "Run" to execute
   - Repeat for `0002_ops_functions.sql`

**Option 2: Via psql Command Line**

```bash
# Set your database connection string
export DATABASE_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres"

# Run migrations in order
psql $DATABASE_URL -f supabase/migrations/0001_ops_schema.sql
psql $DATABASE_URL -f supabase/migrations/0002_ops_functions.sql
```

**Option 3: Via Supabase CLI**

```bash
# Install Supabase CLI first
npm install -g supabase

# Link your project
supabase link --project-ref your-project-id

# Push migrations
supabase db push
```

### Verifying Schema

After running migrations, verify the schema:

```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE 'ops_%'
ORDER BY table_name;

-- Expected output:
-- ops_agent_events
-- ops_agent_reactions
-- ops_mission_proposals
-- ops_missions
-- ops_mission_steps
-- ops_policy
-- ops_step_dead_letters
-- ops_demand_radar

-- Check functions exist
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name LIKE 'ops_%'
ORDER BY routine_name;
```

### Seeding Initial Policies

Create a default policy configuration:

```sql
-- Insert default policy
INSERT INTO ops_policy (id, reaction_matrix, auto_approve, proposal_caps, worker_policy, agent_roles)
VALUES (
  1,
  '{
    "patterns": [
      {
        "id": "test-request",
        "event_type": "user:request",
        "probability": 1.0,
        "cooldown_minutes": 0,
        "source": "manual",
        "template": {
          "title": "Test: {{event.data.prompt}}",
          "risk_level": "low",
          "steps": [
            {
              "kind": "test_step",
              "executor": "noop",
              "params": {"test": true}
            }
          ]
        }
      }
    ]
  }'::jsonb,
  '{
    "enabled": true,
    "allowed_step_kinds": ["noop", "test_step"],
    "max_risk_level": "low"
  }'::jsonb,
  '{
    "daily_limit": 100,
    "per_source_limits": {}
  }'::jsonb,
  '{
    "max_retries": 2,
    "allowed_openclaw_subcommands": ["agent"],
    "lease_duration_minutes": 10
  }'::jsonb,
  '{
    "sage": {
      "model": "gpt-4o",
      "tools": ["browser", "files"],
      "instructions": "You are a wise analyst."
    },
    "minion": {
      "model": "gpt-4o-mini",
      "tools": ["shell"],
      "instructions": "Execute tasks efficiently."
    }
  }'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  reaction_matrix = EXCLUDED.reaction_matrix,
  auto_approve = EXCLUDED.auto_approve,
  worker_policy = EXCLUDED.worker_policy,
  agent_roles = EXCLUDED.agent_roles;
```

### Setting Up Test Data

Create a test event to verify the system:

```sql
-- Insert a test event
INSERT INTO ops_agent_events (type, source, data)
VALUES (
  'user:request',
  'manual',
  '{"prompt": "Test the system", "test": true}'::jsonb
);

-- Verify it was created
SELECT * FROM ops_agent_events ORDER BY created_at DESC LIMIT 1;
```

---

## 🚀 Running the System Locally

The Ops-Loop has two main processes that run continuously:

### 1. Starting the Heartbeat

The heartbeat processes events and triggers reactions. It should run periodically (e.g., every 5 minutes).

```bash
cd /path/to/ops-loop/local
npm run heartbeat
```

**What it does:**
- Fetches recent events from `ops_agent_events`
- Evaluates reaction matrix patterns
- Creates queued reactions in `ops_agent_reactions`
- Converts reactions to proposals (with auto-approval check)
- Recovers stale mission steps

**Expected output:**
```
⏰ Heartbeat: Processing 25 events
⏰ Heartbeat: Created 3 reactions
⏰ Heartbeat: Created 2 proposals (1 auto-approved)
⏰ Heartbeat: Recovered 0 stale steps
✅ Heartbeat complete in 1.2s
```

**Common issues:**
- If you see `SUPABASE_URL not set`, check your `.env` file
- If you see `Database connection failed`, verify your credentials
- If you see `Policy not found`, run the policy seeding SQL above

### 2. Starting the Worker

The worker claims and executes mission steps. It should run frequently (e.g., every 1 minute).

```bash
cd /path/to/ops-loop/local
npm run worker
```

**What it does:**
- Claims next available step from `ops_mission_steps`
- Executes the step based on its `executor` type
- Updates step status (running → completed/failed)
- Emits events for step completion
- Retries failed steps (up to `OPS_WORKER_MAX_RETRIES`)

**Expected output:**
```
🔧 Worker: Looking for work...
🔧 Worker: Claimed step 123 (openclaw)
🔧 Worker: Executing openclaw agent...
🔧 Worker: Step completed in 45s
🔧 Worker: No more work, sleeping...
```

**Common issues:**
- If you see `No work available`, this is normal - create a proposal first
- If you see `Executor not found`, check the executor type in the step
- If you see `OpenClaw timeout`, increase `OPENCLAW_TIMEOUT_MS` in `.env`

### 3. Setting Up Crontab (Recommended)

For automated operation, add to your crontab:

```bash
crontab -e
```

Add these lines:

```cron
# Run heartbeat every 5 minutes
*/5 * * * * cd /path/to/ops-loop/local && npm run heartbeat >> logs/heartbeat.log 2>&1

# Run worker every 1 minute
*/1 * * * * cd /path/to/ops-loop/local && npm run worker >> logs/worker.log 2>&1
```

Create logs directory first:

```bash
mkdir -p /path/to/ops-loop/local/logs
```

### Verifying Operation

Check that both processes are working:

```bash
# Check for recent events
psql $DATABASE_URL -c "SELECT type, source, created_at FROM ops_agent_events ORDER BY created_at DESC LIMIT 5;"

# Check for proposals
psql $DATABASE_URL -c "SELECT title, status, created_at FROM ops_mission_proposals ORDER BY created_at DESC LIMIT 5;"

# Check for active missions
psql $DATABASE_URL -c "SELECT id, status, step_count FROM ops_missions WHERE status = 'active';"

# Check for claimed steps
psql $DATABASE_URL -c "SELECT id, kind, status, claimed_at FROM ops_mission_steps WHERE status = 'running';"
```

---

## 🧪 Testing Workflows

### Manual Testing Procedure

**1. Create a Test Event**

```sql
INSERT INTO ops_agent_events (type, source, data)
VALUES (
  'user:request',
  'manual',
  '{"prompt": "Analyze system performance", "context": "testing"}'::jsonb
);
```

**2. Run Heartbeat**

```bash
npm run heartbeat
```

**Expected:** Heartbeat processes the event and creates a reaction (if pattern matches).

**3. Check for Reactions**

```sql
SELECT * FROM ops_agent_reactions ORDER BY created_at DESC LIMIT 1;
```

**4. Check for Proposals**

```sql
SELECT id, title, status, risk_level, created_at 
FROM ops_mission_proposals 
ORDER BY created_at DESC 
LIMIT 1;
```

**5. If Proposal Created, Run Worker**

```bash
npm run worker
```

**6. Monitor Progress**

```sql
-- Check mission steps
SELECT id, kind, status, executor, result 
FROM ops_mission_steps 
WHERE mission_id = (
  SELECT id FROM ops_missions 
  ORDER BY created_at DESC 
  LIMIT 1
)
ORDER BY sequence_order;
```

### Multi-Agent Collaboration Test

The full test validates the **Scout → Sage → Quill → Xalt** workflow. See [TESTING.md](../TESTING.md) for complete test results.

**Quick validation:**

```sql
-- Check that all agents have executed
SELECT 
  m.id as mission_id,
  COUNT(DISTINCT s.executor) as agents_used,
  STRING_AGG(DISTINCT s.executor, ', ') as executors
FROM ops_missions m
JOIN ops_mission_steps s ON s.mission_id = m.id
WHERE m.created_at > NOW() - INTERVAL '1 hour'
GROUP BY m.id;
```

### Failure Scenario Testing

Test error handling by creating a failing step:

```sql
-- Create proposal with failing step
SELECT ops_create_proposal_and_maybe_autoapprove(
  'Test Failure Scenario',
  'low',
  '[
    {"kind": "fail_test", "executor": "noop", "params": {"should_fail": true}}
  ]'::jsonb,
  'manual'
);
```

Run worker and verify:

```sql
-- Check for dead letter
SELECT * FROM ops_step_dead_letters ORDER BY failed_at DESC LIMIT 1;

-- Check retry count
SELECT id, kind, status, retry_count 
FROM ops_mission_steps 
WHERE kind = 'fail_test';
```

### Performance Testing

Measure heartbeat performance:

```bash
time npm run heartbeat
```

Measure worker performance:

```sql
-- Average step execution time
SELECT 
  executor,
  AVG(EXTRACT(EPOCH FROM (completed_at - claimed_at))) as avg_seconds,
  COUNT(*) as step_count
FROM ops_mission_steps
WHERE completed_at IS NOT NULL
GROUP BY executor
ORDER BY avg_seconds DESC;
```

---

## 🔍 Debugging Techniques

### Logging and Observability

**Enable Verbose Logging**

Edit `src/heartbeat.mjs` or `src/worker.mjs` to add more logging:

```javascript
console.log('🔍 Debug:', JSON.stringify(data, null, 2));
```

**Check Worker Logs**

```bash
tail -f logs/worker.log
```

**Check Heartbeat Logs**

```bash
tail -f logs/heartbeat.log
```

### Querying Database State

**Check Recent Events**

```sql
SELECT 
  id,
  type,
  source,
  data,
  created_at
FROM ops_agent_events
ORDER BY created_at DESC
LIMIT 10;
```

**Check Reactions and Their Status**

```sql
SELECT 
  r.id,
  r.event_type,
  r.status,
  r.proposal_id,
  e.type as event_type,
  e.data as event_data
FROM ops_agent_reactions r
JOIN ops_agent_events e ON e.id = r.event_id
ORDER BY r.created_at DESC
LIMIT 10;
```

**Check Proposal Flow**

```sql
-- From event to proposal
SELECT 
  e.id as event_id,
  e.type as event_type,
  r.id as reaction_id,
  r.status as reaction_status,
  p.id as proposal_id,
  p.title as proposal_title,
  p.status as proposal_status,
  p.auto_approved
FROM ops_agent_events e
LEFT JOIN ops_agent_reactions r ON r.event_id = e.id
LEFT JOIN ops_mission_proposals p ON p.id = r.proposal_id
ORDER BY e.created_at DESC
LIMIT 10;
```

**Check Mission Progress**

```sql
SELECT 
  m.id as mission_id,
  m.status as mission_status,
  COUNT(s.id) as total_steps,
  SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) as completed_steps,
  SUM(CASE WHEN s.status = 'failed' THEN 1 ELSE 0 END) as failed_steps,
  SUM(CASE WHEN s.status = 'running' THEN 1 ELSE 0 END) as running_steps
FROM ops_missions m
LEFT JOIN ops_mission_steps s ON s.mission_id = m.id
GROUP BY m.id
ORDER BY m.created_at DESC;
```

### Inspecting Events and Reactions

**View Event Details**

```sql
SELECT 
  id,
  type,
  source,
  jsonb_pretty(data) as data,
  created_at
FROM ops_agent_events
WHERE id = <event-id>;
```

**View Reaction Matrix Evaluation**

```sql
-- Check what patterns would match an event
SELECT 
  jsonb_array_elements(policy->'reaction_matrix'->'patterns') as pattern
FROM ops_policy
WHERE id = 1;
```

### Tracing Proposal → Mission → Step Flow

```sql
-- Full trace from event to step execution
WITH trace AS (
  SELECT 
    e.id as event_id,
    e.type as event_type,
    r.id as reaction_id,
    p.id as proposal_id,
    p.title as proposal_title,
    m.id as mission_id,
    s.id as step_id,
    s.kind as step_kind,
    s.status as step_status,
    s.executor,
    s.result
  FROM ops_agent_events e
  LEFT JOIN ops_agent_reactions r ON r.event_id = e.id
  LEFT JOIN ops_mission_proposals p ON p.id = r.proposal_id
  LEFT JOIN ops_missions m ON m.proposal_id = p.id
  LEFT JOIN ops_mission_steps s ON s.mission_id = m.id
  WHERE e.id = <event-id>
)
SELECT * FROM trace;
```

### Common Error Patterns

**1. "Policy not found"**
- Cause: No policy row in `ops_policy` table
- Fix: Run the policy seeding SQL from above

**2. "Pattern match failed"**
- Cause: Event type doesn't match any reaction matrix pattern
- Fix: Check your reaction matrix patterns in policy

**3. "Step not claimed"**
- Cause: Worker not running or no available steps
- Fix: Start worker with `npm run worker`

**4. "Executor not found"**
- Cause: Invalid executor type in step configuration
- Fix: Use valid executors: `openclaw`, `wreckit`, `radar`, `minion`, `noop`

**5. "OpenClaw timeout"**
- Cause: Step execution taking too long
- Fix: Increase `OPENCLAW_TIMEOUT_MS` or optimize the agent task

**6. "Auto-approval denied"**
- Cause: Step kind or risk level not in auto-approve policy
- Fix: Update `auto_approve` policy or create lower-risk steps

---

## 🔧 Common Development Tasks

### Adding a New Reaction Pattern

Edit the policy in the database:

```sql
UPDATE ops_policy
SET reaction_matrix = jsonb_set(
  reaction_matrix,
  '{patterns}',
  reaction_matrix->'patterns' || '[{
    "id": "my-new-pattern",
    "event_type": "custom:event",
    "probability": 1.0,
    "cooldown_minutes": 60,
    "source": "trigger",
    "template": {
      "title": "Process {{event.data.action}}",
      "risk_level": "low",
      "steps": [
        {
          "kind": "custom_step",
          "executor": "noop",
          "params": {"action": "{{event.data.action}}"}
        }
      ]
    }
  }]'::jsonb
)
WHERE id = 1;
```

Test the new pattern:

```sql
-- Insert test event
INSERT INTO ops_agent_events (type, source, data)
VALUES ('custom:event', 'test', '{"action": "test_action"}'::jsonb);

-- Run heartbeat
-- (in terminal) npm run heartbeat

-- Check reaction created
SELECT * FROM ops_agent_reactions WHERE event_type = 'custom:event';
```

### Modifying Agent Configuration

```sql
UPDATE ops_policy
SET agent_roles = jsonb_set(
  agent_roles,
  '{my_agent}',
  '{
    "model": "gpt-4o",
    "tools": ["browser", "files", "shell"],
    "instructions": "You are a custom agent with special powers.",
    "temperature": 0.7,
    "max_tokens": 2000
  }'::jsonb
)
WHERE id = 1;
```

Or use the Node.js script:

```bash
cd local
node configure_sage.js  # Edit this file to configure other agents
```

### Creating a Custom Executor

1. Create executor file in `local/src/executors/`:

```javascript
// local/src/executors/my-executor.mjs
export async function execute(step, config) {
  const { params } = step;
  
  try {
    // Your custom logic here
    const result = await doSomething(params);
    
    return {
      success: true,
      output: result,
      metadata: { executionTime: Date.now() }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      output: null
    };
  }
}
```

2. Register in `local/src/executors/index.mjs`:

```javascript
import { execute as myExecutor } from './my-executor.mjs';

export const executors = {
  // ... existing executors
  my_executor: myExecutor
};
```

3. Use in proposal template:

```sql
SELECT ops_create_proposal_and_maybe_autoapprove(
  'Test Custom Executor',
  'low',
  '[{"kind": "custom_task", "executor": "my_executor", "params": {"param": "value"}}]'::jsonb,
  'manual'
);
```

### Updating Policy Gates

Modify the `ops_gate_proposal` function in Supabase:

```sql
CREATE OR REPLACE FUNCTION ops_gate_proposal(
  p_title TEXT,
  p_steps JSONB,
  p_source TEXT
) RETURNS JSONB AS $$
DECLARE
  policy JSONB;
  caps JSONB;
  proposal_count INTEGER;
BEGIN
  -- Get policy
  SELECT proposal_caps INTO policy
  FROM ops_policy
  WHERE id = 1;
  
  -- Check daily limit
  SELECT COUNT(*) INTO proposal_count
  FROM ops_mission_proposals
  WHERE DATE(created_at) = CURRENT_DATE;
  
  IF proposal_count >= (policy->>'daily_limit')::INTEGER THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Daily proposal limit exceeded'
    );
  END IF;
  
  -- Add your custom gate logic here
  
  RETURN jsonb_build_object('allowed', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Writing Proposal Templates

Template structure:

```json
{
  "title": "Human-readable title with {{variables}}",
  "risk_level": "low|medium|high",
  "steps": [
    {
      "kind": "step_type",
      "executor": "executor_name",
      "params": {
        "param1": "value1",
        "param2": "{{event.data.field}}"
      }
    }
  ]
}
```

Template variables use Mustache syntax:
- `{{event.data.field}}` - Field from event data
- `{{event.type}}` - Event type
- `{{event.source}}` - Event source

Example:

```sql
SELECT ops_create_proposal_and_maybe_autoapprove(
  'Analyze {{event.data.topic}} trends',
  'low',
  '[{
    "kind": "research",
    "executor": "openclaw",
    "params": {
      "agent": "analyst",
      "prompt": "Research {{event.data.topic}} trends",
      "tools": ["browser"]
    }
  }]'::jsonb,
  'manual'
);
```

---

## 🔄 Development Workflow

### Local Development Cycle

1. **Make code changes** in `local/src/` or migration files
2. **Test changes** locally with `npm run heartbeat` or `npm run worker`
3. **Verify database state** with SQL queries
4. **Commit changes** with descriptive message
5. **Push to feature branch** for review

### Testing Changes Before Deployment

**1. Unit Test Changes**

```bash
# Test specific module
node local/src/test_module.mjs
```

**2. Integration Test**

```sql
-- Create test event
INSERT INTO ops_agent_events (type, source, data)
VALUES ('test:integration', 'dev', '{"test": true}'::jsonb);

-- Run heartbeat
npm run heartbeat

-- Verify results
SELECT * FROM ops_mission_proposals WHERE title LIKE '%test%' ORDER BY created_at DESC LIMIT 1;
```

**3. End-to-End Test**

```bash
# Full workflow
npm run heartbeat && npm run worker
```

### Code Organization

```
local/
├── src/
│   ├── heartbeat.mjs          # Event processing
│   ├── worker.mjs             # Step execution
│   ├── lib/
│   │   ├── supabase.mjs       # Database client
│   │   └── policy.mjs         # Policy evaluation
│   └── executors/
│       ├── index.mjs          # Executor registry
│       ├── openclaw.mjs       # OpenClaw integration
│       ├── wreckit.mjs        # Wreckit integration
│       ├── radar.mjs          # Radar integration
│       ├── minion.mjs         # Minion executor
│       └── noop.mjs           # Noop executor (testing)
├── configure_sage.js          # Agent configuration helper
├── scaffold_agents.js         # Agent scaffolding
├── test_minion.js             # Minion executor tests
├── package.json               # Dependencies and scripts
└── .env                       # Environment variables (not in git)
```

### Best Practices

1. **Always test migrations** in development before production
2. **Use transactions** when making multiple database changes
3. **Log errors** with context for debugging
4. **Validate input** before creating proposals or steps
5. **Handle edge cases** (null values, missing data, timeouts)
6. **Document changes** in comments and commit messages
7. **Keep functions small** and focused on single responsibility
8. **Use environment variables** for configuration, not hardcoded values

---

## 📚 Additional Resources

- [System Overview](SYSTEM_OVERVIEW.md) - Executive summary and architecture
- [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md) - Technical details
- [Agent Guide](AGENT_GUIDE.md) - Agent roles and configuration
- [Policy Configuration](POLICY_CONFIGURATION.md) - Policy system reference
- [Operations Runbook](OPERATIONS_RUNBOOK.md) - Deployment and operations
- [API Reference](API_REFERENCE.md) - Complete API documentation
- [Integration Guides](INTEGRATION_GUIDES.md) - Executor integration

---

## ❓ Getting Help

**Common Issues:**

| Issue | Solution |
|-------|----------|
| Database connection fails | Check `.env` credentials and Supabase project status |
| Heartbeat creates no reactions | Verify reaction matrix patterns match your events |
| Worker claims no steps | Create proposals first; check step status is `pending` |
| OpenClaw executor fails | Verify binary path and agent configuration |
| Step stuck in "running" | Check for stale step recovery in heartbeat |

**Debugging Commands:**

```bash
# Check database connectivity
psql $DATABASE_URL -c "SELECT 1;"

# View recent errors
psql $DATABASE_URL -c "SELECT * FROM ops_step_dead_letters ORDER BY failed_at DESC LIMIT 5;"

# Count pending steps
psql $DATABASE_URL -c "SELECT COUNT(*) FROM ops_mission_steps WHERE status = 'pending';"

# View policy configuration
psql $DATABASE_URL -c "SELECT jsonb_pretty(policy) FROM ops_policy WHERE id = 1;"
```

**Next Steps:**

1. Complete the setup verification above
2. Read [TESTING.md](../TESTING.md) for test procedures
3. Review [ARCHITECTURE_DEEP_DIVE.md](ARCHITECTURE_DEEP_DIVE.md) for system details
4. Explore [Policy Configuration](POLICY_CONFIGURATION.md) to customize behavior

---

**Last Updated:** 2025-02-07
**Maintained By:** VoxYZ Development Team
