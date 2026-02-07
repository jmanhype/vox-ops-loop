# VoxYZ System Validation (TESTING.md)

> **📚 For detailed testing procedures and development workflows, see [docs/DEVELOPER_ONBOARDING.md#testing-workflows](docs/DEVELOPER_ONBOARDING.md#testing-workflows)**

## 🎯 Test Objective
Validate the full multi-agent collaboration loop: **Scout → Sage → Quill → Xalt**.

## 📋 Test Plan
1. **Trigger:** Inject a `user:request` event for trend discovery.
2. **Phase 1 (Scout):** Verify Scout picks up the request and generates a discovery report.
3. **Phase 2 (Sage):** Verify Sage analyzes the Scout report and recommends content creation.
4. **Phase 3 (Quill):** Verify Quill takes the recommendation and produces a draft.
5. **Phase 4 (Xalt):** Verify Xalt receives the draft for final deployment.

## 📊 Results Log
| Phase | Agent | Status | Notes |
|-------|-------|--------|-------|
| 1 | Scout | ✅ Success | Request -> Mission transition verified. |
| 2 | Sage | ✅ Success | Report -> Analysis transition verified. |
| 3 | Minion | ✅ Success | Recommendation -> Execution transition verified. |
| 4 | Quill | ✅ Success | Content Request -> Drafting transition verified. |
| 5 | Xalt | ✅ Success | Draft Ready -> Posting transition verified. |

**Full System Loop Verified:** 2026-02-07

## 🛠️ Verification Commands
- `npm run heartbeat`: Processes the event bus.
- `npm run worker`: Executes the active mission steps.
- Dashboard: Check `Consciousness Stream` for real-time progress.

## 📝 Test Data Setup

### Create Test Event

```sql
-- Insert a test user request event
INSERT INTO ops_agent_events (event_type, source, data)
VALUES (
  'user:request',
  'test',
  '{"topic": "AI trends 2025", "context": "market research"}'::jsonb
);

-- Verify event was created
SELECT * FROM ops_agent_events ORDER BY created_at DESC LIMIT 1;
```

### Create Test Proposal

```sql
-- Create a simple test proposal
SELECT ops_create_proposal_and_maybe_autoapprove(
  'Test multi-agent loop',
  'low'::ops_risk_level,
  jsonb_build_array(
    jsonb_build_object(
      'kind', 'openclaw',
      'executor', 'openclaw',
      'params', jsonb_build_object(
        'subcommand', 'agent',
        'agent', 'scout',
        'prompt', 'Research AI trends for 2025'
      )
    )
  ),
  'test'
);

-- Verify proposal was created
SELECT * FROM ops_mission_proposals ORDER BY created_at DESC LIMIT 1;
```

### Seed Test Policies

```sql
-- Ensure test-friendly policies are in place
UPDATE ops_policy
SET value = jsonb_build_object(
  'enabled', true,
  'allowed_step_kinds', jsonb_build_array('openclaw', 'wreckit', 'radar', 'minion')
)
WHERE key = 'auto_approve';

-- Verify policy
SELECT key, value FROM ops_policy WHERE key = 'auto_approve';
```

## 🔬 Failure Scenario Testing

### Test 1: Proposal Gating

**Objective**: Verify proposal caps are enforced

```sql
-- Set low proposal cap
UPDATE ops_policy
SET value = jsonb_build_object(
  'daily_limit', 2,
  'per_source_limits', jsonb_build_object('test', 1)
)
WHERE key = 'proposal_caps';

-- Attempt to create 3 proposals (should fail on 3rd)
SELECT ops_create_proposal_and_maybe_autoapprove('Test 1', 'low', '[...]', 'test');
SELECT ops_create_proposal_and_maybe_autoapprove('Test 2', 'low', '[...]', 'test');
SELECT ops_create_proposal_and_maybe_autoapprove('Test 3', 'low', '[...]', 'test');  -- Should error

-- Verify gate was triggered
SELECT * FROM ops_mission_proposals WHERE source = 'test';
```

### Test 2: Step Failure Recovery

**Objective**: Verify worker retries and dead letter handling

```sql
-- Create a proposal with a failing step
SELECT ops_create_proposal_and_maybe_autoapprove(
  'Test failure recovery',
  'low',
  jsonb_build_array(
    jsonb_build_object(
      'kind', 'failing_step',
      'executor', 'openclaw',
      'params', jsonb_build_object('prompt', 'this will fail')
    )
  ),
  'test'
);

-- Run worker and observe retries
-- After 3 retries, check dead letters
SELECT * FROM ops_step_dead_letters ORDER BY created_at DESC LIMIT 1;
```

### Test 3: Stale Step Recovery

**Objective**: Verify heartbeat recovers stale steps

```sql
-- Claim a step but don't process it
UPDATE ops_mission_steps
SET status = 'claimed', claimed_at = NOW() - INTERVAL '15 minutes'
WHERE id = (SELECT id FROM ops_mission_steps WHERE status = 'pending' LIMIT 1);

-- Run heartbeat (should recover the stale step)
npm run heartbeat

-- Verify step was recovered
SELECT * FROM ops_mission_steps WHERE status = 'pending';
```

## ⚡ Performance Testing

### Test: Batch Processing

**Objective**: Verify system can handle event batches

```bash
# Insert 100 test events
for i in {1..100}; do
  psql -c "INSERT INTO ops_agent_events (event_type, source, data) VALUES ('test:batch', 'performance', '{\"index\": $i}')"
done

# Run heartbeat and verify processing
npm run heartbeat

# Check processing time
SELECT
  COUNT(*) as events_processed,
  MAX(created_at) - MIN(created_at) as duration
FROM ops_agent_events
WHERE source = 'performance' AND created_at > NOW() - INTERVAL '5 minutes';
```

### Test: Concurrent Workers

**Objective**: Verify lease mechanism prevents duplicate work

```bash
# Start two workers simultaneously
npm run worker &
WORKER1_PID=$!
npm run worker &
WORKER2_PID=$!

# Wait and verify no duplicate step claims
sleep 10
kill $WORKER1_PID $WORKER2_PID

# Check for duplicate claims
SELECT
  mission_id,
  COUNT(*) as claim_count
FROM ops_mission_steps
WHERE status = 'claimed'
GROUP BY mission_id
HAVING COUNT(*) > 1;
-- Should return 0 rows
```

## 🐛 Common Test Issues

### Issue: Events not processing

**Symptoms**: Events in `ops_agent_events` but no reactions created

**Diagnosis**:
```sql
-- Check if reaction matrix is configured
SELECT value FROM ops_policy WHERE key = 'reaction_matrix';

-- Check if heartbeat ran recently
SELECT * FROM ops_action_runs ORDER BY created_at DESC LIMIT 5;

-- Check for processing errors
SELECT * FROM ops_action_runs WHERE error IS NOT NULL;
```

**Resolution**:
- Verify reaction matrix patterns match event types
- Check heartbeat cron is running
- Review heartbeat logs for errors

### Issue: Steps not being claimed

**Symptoms**: Steps in `ops_mission_steps` with status `pending`

**Diagnosis**:
```sql
-- Check if worker is running
SELECT * FROM ops_action_runs WHERE action = 'claim_step' ORDER BY created_at DESC LIMIT 5;

-- Check for lease conflicts
SELECT * FROM ops_mission_steps WHERE status = 'claimed' AND claimed_at < NOW() - INTERVAL '5 minutes';
```

**Resolution**:
- Verify worker process is running
- Check database connection
- Ensure worker has correct environment variables

### Issue: Auto-approval not working

**Symptoms**: Proposals created but not auto-approved

**Diagnosis**:
```sql
-- Check auto-approve policy
SELECT value FROM ops_policy WHERE key = 'auto_approve';

-- Check proposal risk level
SELECT id, title, risk_level, status FROM ops_mission_proposals ORDER BY created_at DESC LIMIT 5;

-- Check gating function
SELECT ops_gate_proposal('test', 'low');
```

**Resolution**:
- Ensure `auto_approve.enabled = true`
- Verify step kinds are in `allowed_step_kinds`
- Check proposal caps not exceeded
