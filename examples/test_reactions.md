# Testing Reaction Matrix

## 1. Seed the Reaction Matrix

Copy the content from `reaction_matrix_seed.sql` and paste it into:
- Supabase Dashboard → SQL Editor
- Or run via CLI: `psql < reaction_matrix_seed.sql`

This creates:
- 3 reaction patterns (catch-all, failure analysis, success celebration)
- Auto-approve enabled for `noop` and `openclaw` steps
- Proposal caps (100/day)
- Worker policy safeguards

## 2. Verify Policies Work

Check that policies are set:

```sql
SELECT key, jsonb_pretty(value) as policy
FROM ops_policy
WHERE key IN ('reaction_matrix', 'auto_approve', 'proposal_caps', 'worker_policy');
```

## 3. Set Up Local Environment

```bash
cd /Users/speed/.openclaw/workspace/ops-loop/local
npm install
cp .env.example .env

# Edit .env and add your Supabase credentials:
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 4. Test Heartbeat (Trigger Evaluation)

Run the heartbeat - it should process any unprocessed events:

```bash
npm run heartbeat
```

Expected output (JSON):
```json
{
  "ok": true,
  "triggerResult": {
    "events": 0,
    "queued": 0
  },
  "reactionResult": {
    "processed": 0,
    "created": 0
  },
  "leaseResult": {
    "requeued_steps": 0,
    "failed_steps": 0
  },
  "staleResult": {
    "recovered": 0
  }
}
```

## 5. Create a Test Event (Trigger Reactions)

Insert a test event to trigger the reaction matrix:

```sql
INSERT INTO ops_agent_events (type, data, dedupe_key)
VALUES (
  'test:event',
  jsonb_build_object(
    'source', 'manual_test',
    'tags', jsonb_build_array('test'),
    'message', 'Testing reaction matrix'
  ),
  'test-event-' || extract(epoch from now())::bigint
);
```

## 6. Run Heartbeat Again

```bash
npm run heartbeat
```

Expected output:
```json
{
  "ok": true,
  "triggerResult": {
    "events": 1,
    "queued": 1
  },
  "reactionResult": {
    "processed": 1,
    "created": 1
  },
  ...
}
```

## 7. Verify Proposal Was Created

```sql
SELECT
  id,
  status,
  source,
  jsonb_pretty(template) as proposal_template,
  created_at
FROM ops_mission_proposals
ORDER BY created_at DESC
LIMIT 5;
```

You should see:
- A proposal with `source = 'trigger'`
- Status should be `auto_approved` (if using noop steps)
- A corresponding mission in `ops_missions`

## 8. Run Worker (Execute Steps)

```bash
npm run worker
```

Expected output:
```
No queued steps
```

Or if there are queued steps:
```
Step <uuid> succeeded
```

## 9. Verify Events Triggered Reactions

Check that events generated reactions:

```sql
SELECT
  r.id,
  r.status,
  r.payload,
  e.type as event_type
FROM ops_agent_reactions r
JOIN ops_agent_events e ON r.event_id = e.id
ORDER BY r.created_at DESC
LIMIT 5;
```

## 10. Test Failure Reaction (Optional)

Create a step that will fail to test the failure analysis pattern:

```sql
-- Create a proposal with a failing step
INSERT INTO ops_mission_proposals (source, status, template)
VALUES (
  'manual_test',
  'pending',
  jsonb_build_object(
    'title', 'Test failure reaction',
    'risk_level', 'low',
    'steps', jsonb_build_array(
      jsonb_build_object(
        'kind', 'will_fail',
        'executor': 'noop',
        'params', jsonb_build_object('force_failure', true)
      )
    )
  )
)
RETURNING id;
```

Then manually approve it:

```sql
-- Get the proposal ID from above, then:
SELECT ops_create_mission_from_proposal('<proposal-id>');
```

Run worker and check that failure event triggers the `analyze-failure` reaction.

## Troubleshooting

**No events processed:**
- Check that `ops_agent_events` has unprocessed rows:
  ```sql
  SELECT * FROM ops_agent_events WHERE processed_at IS NULL;
  ```

**No reactions queued:**
- Verify reaction_matrix is set correctly
- Check pattern matching: the `catch-all-test` pattern should match everything

**Proposals not auto-approved:**
- Check `auto_approve` policy:
  ```sql
  SELECT jsonb_pretty(value) FROM ops_policy WHERE key = 'auto_approve';
  ```
- Ensure step kinds are in `allowed_step_kinds`

**Worker has no queued steps:**
- Check `ops_mission_steps` for queued status:
  ```sql
  SELECT * FROM ops_mission_steps WHERE status = 'queued';
  ```
- Verify missions were created from proposals

## Cron Setup (Automated Running)

Add to crontab (`crontab -e`):

```
*/5 * * * * cd /Users/speed/.openclaw/workspace/ops-loop/local && npm run heartbeat
*/1 * * * * cd /Users/speed/.openclaw/workspace/ops-loop/local && npm run worker
```

This runs heartbeat every 5 minutes and worker every 1 minute.
