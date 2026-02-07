# VoxYZ Ops-Loop Operations Runbook

## 📋 Overview

This runbook provides operational procedures for deploying, monitoring, troubleshooting, and maintaining the VoxYZ Ops-Loop autonomous multi-agent system in production environments.

**Target Audience:** System operators, DevOps engineers, SREs, and production support staff.

**Scope:** Vercel control plane, Supabase data engine, and local worker operations. Excludes Cybernetic Elixir component (per project scope).

## 📚 Related Documentation

- [System Overview](SYSTEM_OVERVIEW.md) - Executive-level context
- [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md) - Technical architecture
- [Deployment Guide](../DEPLOYMENT.md) - Initial deployment procedures
- [Policy Configuration](POLICY_CONFIGURATION.md) - Policy management
- [API Reference](API_REFERENCE.md) - API and function reference

---

## 🚀 Deployment Procedures

### Pre-Deployment Checklist

Complete all items before deploying to production:

#### Environment Verification
- [ ] Vercel account configured and accessible
- [ ] Supabase project created (URL and credentials available)
- [ ] Local worker environment configured (Node.js 18+ installed)
- [ ] Database migrations tested in staging environment
- [ ] Environment variables documented and approved

#### Security Review
- [ ] `OPS_API_KEY` uses cryptographically secure random string (32+ characters)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` stored securely (not in code)
- [ ] Database access restricted to necessary IPs
- [ ] Vercel environment variables configured (not hardcoded)
- [ ] SSL/TLS enabled for all connections

#### Data Safety
- [ ] Supabase automated backups enabled
- [ ] Point-in-time recovery configured
- [ ] Database schema backed up pre-deployment
- [ ] Policy configurations exported as backup
- [ ] Rollback procedure tested in staging

#### Monitoring Setup
- [ ] Supabase dashboard access configured
- [ ] Vercel analytics enabled
- [ ] Error tracking configured (if applicable)
- [ ] Alert thresholds defined
- [ ] On-call rotation established

#### Functional Testing
- [ ] Heartbeat endpoint tested locally
- [ ] Worker script tested locally
- [ ] Reaction matrix seeded and verified
- [ ] Sample proposal created and approved
- [ ] Worker executed sample steps successfully

### Initial Deployment

#### Step 1: Database Schema Setup

**Option A: Supabase Dashboard (Recommended)**

1. Navigate to Supabase Dashboard → SQL Editor
2. Open migration file `supabase/migrations/0001_ops_schema.sql`
3. Execute script to create all tables
4. Verify tables created:
   ```sql
   SELECT tablename FROM pg_tables WHERE schemaname = 'public'
   AND tablename LIKE 'ops_%';
   ```
   Expected: 8 tables (`ops_policy`, `ops_mission_proposals`, `ops_missions`, `ops_mission_steps`, `ops_agent_events`, `ops_agent_reactions`, `ops_action_runs`, `ops_demand_radar`)

5. Open migration file `supabase/migrations/0002_ops_functions.sql`
6. Execute script to create all functions
7. Verify functions created:
   ```sql
   SELECT routine_name FROM information_schema.routines
   WHERE routine_schema = 'public' AND routine_name LIKE 'ops_%';
   ```
   Expected: 9+ functions

**Option B: CLI (psql)**

```bash
# Set environment variables
export SUPABASE_URL="https://nnmgddhlqfumlstopqxs.supabase.co"
export SUPABASE_DB_PASSWORD="your-database-password"

# Execute migrations
psql "$SUPABASE_URL" -f supabase/migrations/0001_ops_schema.sql
psql "$SUPABASE_URL" -f supabase/migrations/0002_ops_functions.sql
```

#### Step 2: Seed Initial Policies

```bash
# From the ops-loop directory
psql "$SUPABASE_URL" -f supabase/migrations/reaction_matrix_seed.sql
```

Or manually via Supabase Dashboard SQL Editor with contents from `reaction_matrix_seed.sql`.

**Verify policies seeded:**
```sql
SELECT key, jsonb_pretty(value) as policy
FROM ops_policy
WHERE key IN ('reaction_matrix', 'auto_approve', 'proposal_caps', 'worker_policy', 'agent_roles');
```

Expected: 5 policy rows returned.

#### Step 3: Deploy Vercel Control Plane

```bash
cd vercel
vercel deploy --prod
```

Expected output: Deployment URL (e.g., `https://ops-loop-xyz.vercel.app`)

#### Step 4: Configure Vercel Environment Variables

1. Navigate to Vercel Dashboard → Project → Settings → Environment Variables
2. Add production variables:

| Variable | Value | Notes |
|----------|-------|-------|
| `SUPABASE_URL` | `https://nnmgddhlqfumlstopqxs.supabase.co` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbG...` | Service role key (NEVER anon key) |
| `OPS_API_KEY` | Random 32+ char string | Generate with: `openssl rand -base64 32` |

3. Redeploy to apply variables:
   ```bash
   vercel deploy --prod
   ```

#### Step 5: Test Deployed Endpoint

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_OPS_API_KEY" \
  -H "Content-Type: application/json" \
  https://your-project.vercel.app/api/ops/heartbeat
```

Expected response:
```json
{
  "ok": true,
  "triggerResult": {"events": 0, "queued": 0},
  "reactionResult": {"processed": 0, "created": 0},
  "leaseResult": {"requeued_steps": 0, "failed_steps": 0},
  "staleResult": {"recovered": 0}
}
```

#### Step 6: Configure Local Worker

On the worker machine (local server or VPS):

```bash
# Clone or copy the ops-loop/local directory
cd ops-loop/local

# Install dependencies
npm install

# Create environment file
cat > .env << EOF
SUPABASE_URL=https://nnmgddhlqfumlstopqxs.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPS_EVENT_BATCH_SIZE=50
OPS_REACTION_BATCH_SIZE=50
OPS_STEP_LEASE_MINUTES=5
OPS_WORKER_MAX_RETRIES=3
OPS_STALE_STEP_MINUTES=15
EOF

# Test worker
npm run worker
```

Expected output: `No queued steps` (if system is idle)

#### Step 7: Configure Automation (Cron)

Edit crontab:
```bash
crontab -e
```

Add:
```
*/5 * * * * cd /path/to/ops-loop/local && npm run heartbeat >> /var/log/ops-heartbeat.log 2>&1
*/1 * * * * cd /path/to/ops-loop/local && npm run worker >> /var/log/ops-worker.log 2>&1
```

**Verify cron jobs:**
```bash
crontab -l
```

### Zero-Downtime Deployment Strategy

For existing production systems:

#### Vercel Deployment (Zero-Downtime by Default)
Vercel automatically handles zero-downtime deployments:
1. New deployment created
2. Traffic gradually shifted to new deployment
3. Old deployment kept as instant rollback
4. No manual intervention required

#### Database Migrations (Careful Planning Required)

**For additive changes (SAFE):**
- New tables, new columns, new indexes
- Can be deployed before or after code deployment
- Example: Adding a new column with default value

```sql
-- Safe: Additive change
ALTER TABLE ops_mission_steps ADD COLUMN metadata jsonb default '{}'::jsonb;
```

**For destructive changes (REQUIRES PLANNING):**
- Dropping tables/columns, changing types
- Must be deployed in phases with code changes
- Example: Removing a column

**Phase 1: Add new column (code-neutral)**
```sql
ALTER TABLE ops_mission_steps ADD COLUMN new_field text;
```

**Phase 2: Deploy code that writes to both old and new fields**

**Phase 3: Backfill data**
```sql
UPDATE ops_mission_steps SET new_field = old_field WHERE new_field IS NULL;
```

**Phase 4: Deploy code that reads from new field**

**Phase 5: Remove old field**
```sql
ALTER TABLE ops_mission_steps DROP COLUMN old_field;
```

---

## 📊 Monitoring and Observability

### Key Metrics to Monitor

#### System Health Metrics

**Heartbeat Health**
- Frequency: Every 5 minutes
- Metric: `ops_heartbeat_success` (1 = success, 0 = failure)
- Alert if: > 3 consecutive failures
- Query:
  ```sql
  -- Check recent heartbeat success (via ops_agent_events)
  SELECT
    date_trunc('hour', created_at) as hour,
    count(*) filter (where type = 'heartbeat:success') as successes,
    count(*) filter (where type = 'heartbeat:failure') as failures
  FROM ops_agent_events
  WHERE created_at > now() - interval '24 hours'
  GROUP BY 1
  ORDER BY 1 DESC;
  ```

**Worker Health**
- Frequency: Every 1 minute
- Metric: `ops_worker_claims` (steps claimed per heartbeat)
- Alert if: < 1 step claimed in 10 minutes (when queued steps exist)
- Query:
  ```sql
  -- Check worker activity
  SELECT
    date_trunc('hour', reserved_at) as hour,
    count(*) as steps_claimed,
    count(*) filter (where status = 'succeeded') as succeeded,
    count(*) filter (where status = 'failed') as failed
  FROM ops_mission_steps
  WHERE reserved_at > now() - interval '24 hours'
  GROUP BY 1
  ORDER BY 1 DESC;
  ```

#### Performance Metrics

**Proposal Processing Latency**
- Metric: Time from event to proposal creation
- Query:
  ```sql
  SELECT
    avg(extract(epoch from (p.created_at - e.created_at))) as avg_latency_seconds,
    percentile_cont(0.5) within group (extract(epoch from (p.created_at - e.created_at)) order by p.created_at) as p50_latency,
    percentile_cont(0.95) within group (extract(epoch from (p.created_at - e.created_at)) order by p.created_at) as p95_latency
  FROM ops_mission_proposals p
  JOIN ops_agent_events e ON p.source = 'trigger'
  WHERE p.created_at > now() - interval '24 hours';
  ```
- Alert if: p95_latency > 300 seconds (5 minutes)

**Step Execution Duration**
- Metric: Time from queued to succeeded/failed
- Query:
  ```sql
  SELECT
    kind,
    avg(extract(epoch from (updated_at - created_at))) as avg_duration_seconds,
    count(*) as total_steps
  FROM ops_mission_steps
  WHERE status IN ('succeeded', 'failed')
  AND created_at > now() - interval '24 hours'
  GROUP BY kind
  ORDER BY 2 DESC;
  ```
- Alert if: avg_duration_seconds > 600 for any executor

#### Business Metrics

**Proposal Rate**
- Query:
  ```sql
  SELECT
    date_trunc('day', created_at) as day,
    source,
    count(*) as proposals
  FROM ops_mission_proposals
  WHERE created_at > now() - interval '7 days'
  GROUP BY 1, 2
  ORDER BY 1 DESC, 2;
  ```
- Alert if: > 100 proposals/hour (possible abuse)

**Mission Success Rate**
- Query:
  ```sql
  SELECT
    date_trunc('day', completed_at) as day,
    count(*) as total_missions,
    count(*) filter (where status = 'succeeded') as succeeded,
    100.0 * count(*) filter (where status = 'succeeded') / count(*) as success_rate_pct
  FROM ops_missions
  WHERE completed_at > now() - interval '7 days'
  GROUP BY 1
  ORDER BY 1 DESC;
  ```
- Alert if: success_rate_pct < 90

**Dead Letter Rate**
- Query:
  ```sql
  SELECT
    date_trunc('day', updated_at) as day,
    count(*) as dead_letters
  FROM ops_mission_steps
  WHERE status = 'failed' AND failure_count >= (SELECT coalesce((value->>'max_retries')::int, 3) FROM ops_policy WHERE key = 'worker_policy')
  AND updated_at > now() - interval '7 days'
  GROUP BY 1
  ORDER BY 1 DESC;
  ```
- Alert if: > 10 dead_letters/day

### Dashboard Setup

#### Supabase Dashboard Queries

**Create Custom Dashboard in Supabase:**

1. Navigate to Supabase Dashboard → Reports
2. Create new report → Query
3. Add these queries:

**Query 1: Active Missions**
```sql
SELECT
  status,
  count(*) as count
FROM ops_missions
WHERE created_at > now() - interval '24 hours'
GROUP BY status;
```

**Query 2: Queue Depth**
```sql
SELECT
  'queued_events' as metric, count(*) FROM ops_agent_events WHERE processed_at IS NULL
UNION ALL
SELECT 'queued_reactions', count(*) FROM ops_agent_reactions WHERE status = 'queued'
UNION ALL
SELECT 'queued_steps', count(*) FROM ops_mission_steps WHERE status = 'queued';
```

**Query 3: Recent Errors**
```sql
SELECT
  s.kind,
  s.last_error,
  s.updated_at
FROM ops_mission_steps s
WHERE s.status = 'failed'
ORDER BY s.updated_at DESC
LIMIT 20;
```

#### Vercel Analytics

Navigate to Vercel Dashboard → Project → Analytics:

**Key Metrics to Monitor:**
- Response time for `/api/ops/heartbeat` (should be < 1s)
- Error rate (should be 0%)
- Request rate (should match cron schedule: 12 requests/hour)

### Alerting Thresholds

Configure alerts for:

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Heartbeat failures | 3 consecutive | 5 consecutive | Check Vercel logs, restart deployment |
| Worker idle | 10 min with queued steps | 30 min with queued steps | Restart worker process, check logs |
| p95 proposal latency | > 300s | > 600s | Check reaction matrix complexity, database performance |
| Mission success rate | < 95% | < 80% | Review failed missions, check executor health |
| Dead letters/hour | > 5 | > 20 | Review dead letter queue, fix root cause |
| Queue depth (events) | > 100 | > 1000 | Scale heartbeat frequency, check for stuck events |
| Queue depth (steps) | > 50 | > 500 | Scale workers, check for stuck steps |

---

## 🔧 Troubleshooting Guide

### Common Issues and Solutions

#### Issue 1: Heartbeat Not Processing Events

**Symptoms:**
- `triggerResult.events` always shows 0
- `ops_agent_events` table has rows with `processed_at IS NULL`
- No proposals being created

**Diagnosis:**
```sql
-- Check for unprocessed events
SELECT count(*) as unprocessed_events
FROM ops_agent_events
WHERE processed_at IS NULL;

-- Check recent heartbeat calls
SELECT * FROM ops_agent_events
WHERE type IN ('heartbeat:success', 'heartbeat:failure')
ORDER BY created_at DESC
LIMIT 5;
```

**Root Causes & Solutions:**

1. **Heartbeat not running**
   - Check cron: `crontab -l`
   - Check logs: `tail -f /var/log/ops-heartbeat.log`
   - Solution: Restart heartbeat process

2. **Database connection failure**
   - Check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars
   - Test connection: `psql $SUPABASE_URL -c "SELECT 1;"`
   - Solution: Fix environment variables, redeploy

3. **Reaction matrix not configured**
   - Check: `SELECT * FROM ops_policy WHERE key = 'reaction_matrix';`
   - Solution: Seed reaction matrix (see Initial Deployment)

#### Issue 2: No Reactions Created

**Symptoms:**
- Events are being processed (`processed_at` is set)
- `reactionResult.created` shows 0
- `ops_agent_reactions` table empty

**Diagnosis:**
```sql
-- Check if reaction matrix exists
SELECT key, jsonb_pretty(value)
FROM ops_policy
WHERE key = 'reaction_matrix';

-- Check if event types match patterns
SELECT
  e.type,
  e.data,
  e.processed_at
FROM ops_agent_events e
WHERE e.created_at > now() - interval '1 hour'
ORDER BY e.created_at DESC
LIMIT 10;
```

**Root Causes & Solutions:**

1. **No matching patterns in reaction matrix**
   - Check pattern matching logic in heartbeat.ts
   - Solution: Add catch-all pattern or adjust event types

2. **Reaction probability filter**
   - Check if patterns have `probability` field < 1.0
   - Solution: Increase probability or test with more events

3. **Cooldown filter active**
   - Check if patterns have `cooldown_minutes` field
   - Solution: Wait for cooldown or adjust pattern

#### Issue 3: Proposals Not Auto-Approved

**Symptoms:**
- Reactions creating proposals
- All proposals stuck in `pending` status
- `auto_approve` policy configured but not working

**Diagnosis:**
```sql
-- Check auto_approve policy
SELECT jsonb_pretty(value)
FROM ops_policy
WHERE key = 'auto_approve';

-- Check pending proposals
SELECT
  id,
  jsonb_pretty(template) as proposal,
  created_at
FROM ops_mission_proposals
WHERE status = 'pending'
ORDER BY created_at DESC
LIMIT 5;

-- Check if proposal gating function is working
SELECT * FROM ops_gate_proposal(
  (SELECT id FROM ops_mission_proposals WHERE status = 'pending' LIMIT 1)
);
```

**Root Causes & Solutions:**

1. **Auto-approve disabled**
   - Check: `"enabled": true` in auto_approve policy
   - Solution: Update policy:
     ```sql
     UPDATE ops_policy
     SET value = jsonb_set(value, '{enabled}', 'true'::jsonb)
     WHERE key = 'auto_approve';
     ```

2. **Step kind not in allowed list**
   - Check `allowed_step_kinds` in auto_approve policy
   - Solution: Add step kinds:
     ```sql
     UPDATE ops_policy
     SET value = jsonb_set(
       value,
       '{allowed_step_kinds}',
       '["noop", "openclaw", "wreckit", "radar", "minion"]'::jsonb
     )
     WHERE key = 'auto_approve';
     ```

3. **Proposal caps exceeded**
   - Check: `SELECT jsonb_pretty(value) FROM ops_policy WHERE key = 'proposal_caps';`
   - Solution: Increase caps or wait for daily reset

#### Issue 4: Worker Not Claiming Steps

**Symptoms:**
- Steps stuck in `queued` status
- `npm run worker` shows "No queued steps" but steps exist
- Worker process appears idle

**Diagnosis:**
```sql
-- Check for queued steps
SELECT
  id,
  kind,
  executor,
  created_at,
  reserved_at,
  lease_expires_at
FROM ops_mission_steps
WHERE status = 'queued'
ORDER BY created_at ASC
LIMIT 10;

-- Check for stale leases (steps stuck in 'running')
SELECT
  id,
  kind,
  status,
  reserved_at,
  lease_expires_at,
  failure_count
FROM ops_mission_steps
WHERE status = 'running'
AND lease_expires_at < now() - interval '5 minutes';
```

**Root Causes & Solutions:**

1. **Worker not running**
   - Check cron: `crontab -l`
   - Check process: `ps aux | grep "npm run worker"`
   - Solution: Start worker process

2. **Database connection issue**
   - Check env vars in `.env` file
   - Test connection: `psql $SUPABASE_URL -c "SELECT 1;"`
   - Solution: Fix database credentials

3. **Lease expired but not recovered**
   - Stale steps should be auto-recovered by heartbeat
   - Manual recovery:
     ```sql
     SELECT ops_recover_stale_steps();
     ```

4. **Worker policy blocking executor**
   - Check worker policy for executor restrictions
   - Solution: Update worker policy to allow executor

#### Issue 5: Steps Failing Repeatedly

**Symptoms:**
- Steps hitting max retries
- Dead letter queue growing
- `last_error` shows consistent failure

**Diagnosis:**
```sql
-- Check failed steps
SELECT
  id,
  kind,
  executor,
  failure_count,
  max_retries,
  last_error,
  updated_at
FROM ops_mission_steps
WHERE status = 'failed'
ORDER BY updated_at DESC
LIMIT 20;

-- Check for dead letters
SELECT
  s.*,
  m.status as mission_status
FROM ops_mission_steps s
JOIN ops_missions m ON s.mission_id = m.id
WHERE s.status = 'failed'
AND s.failure_count >= (SELECT coalesce((value->>'max_retries')::int, 3) FROM ops_policy WHERE key = 'worker_policy')
ORDER BY s.updated_at DESC;
```

**Root Causes & Solutions:**

1. **Executor misconfiguration**
   - Check `executor` field matches valid executor names
   - Check `params` field has required parameters
   - Solution: Fix proposal template, re-create proposal

2. **External service failure**
   - Check if OpenClaw, Wreckit, or Radar services are down
   - Solution: Fix external service, manual retry

3. **Insufficient permissions**
   - Check if worker has necessary permissions
   - Solution: Update worker environment or credentials

4. **Bug in executor code**
   - Check executor implementation in `local/src/executors/`
   - Solution: Fix bug, redeploy worker

**Manual Retry Procedure:**
```sql
-- Reset failed step to queued
UPDATE ops_mission_steps
SET
  status = 'queued',
  reserved_at = NULL,
  lease_expires_at = NULL,
  failure_count = 0,
  last_error = NULL
WHERE id = '<step-id>';

-- Worker will pick it up on next run
```

#### Issue 6: Database Performance Degradation

**Symptoms:**
- Slow query execution
- Heartbeat timing out
- Supabase dashboard shows high CPU

**Diagnosis:**
```sql
-- Check table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
AND tablename LIKE 'ops_%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
AND tablename LIKE 'ops_%'
ORDER BY idx_scan ASC;

-- Check long-running queries (in Supabase Dashboard)
-- Navigate to Database → Query Performance
```

**Solutions:**

1. **Add missing indexes**
   ```sql
   -- Example: Add index for common query pattern
   CREATE INDEX IF NOT EXISTS idx_ops_mission_steps_kind_created
   ON ops_mission_steps (kind, created_at DESC);
   ```

2. **Archive old data**
   ```sql
   -- Archive completed missions older than 90 days
   -- (Implement in application layer)
   ```

3. **Vacuum and analyze**
   ```sql
   VACUUM ANALYZE ops_agent_events;
   VACUUM ANALYZE ops_mission_steps;
   ```

### Error Code Reference

| Error Code | Description | Common Cause | Resolution |
|------------|-------------|--------------|------------|
| `OPS_001` | Database connection failed | Invalid credentials | Check env vars |
| `OPS_002` | Policy not found | Missing policy row | Seed policies |
| `OPS_003` | Proposal gating failed | Caps exceeded | Increase caps |
| `OPS_004` | Invalid proposal template | Schema validation failed | Fix template |
| `OPS_005` | Executor not found | Typo in executor name | Fix template |
| `OPS_006` | Step claim failed | Lease conflict | Wait and retry |
| `OPS_007` | Step execution failed | Executor error | Check logs |
| `OPS_008` | Reaction pattern invalid | Regex error | Fix pattern |
| `OPS_009` | Auto-approval failed | Policy violation | Adjust policy |
| `OPS_010` | Stale step recovery | Too many stale steps | Restart worker |

### Diagnostic Queries

**System Health Overview**
```sql
WITH
event_stats AS (
  SELECT
    count(*) FILTER (WHERE processed_at IS NULL) as unprocessed_events,
    count(*) FILTER (WHERE processed_at > now() - interval '1 hour') as recent_events
  FROM ops_agent_events
  WHERE created_at > now() - interval '24 hours'
),
reaction_stats AS (
  SELECT
    count(*) FILTER (WHERE status = 'queued') as queued_reactions,
    count(*) FILTER (WHERE status = 'processing') as processing_reactions
  FROM ops_agent_reactions
  WHERE created_at > now() - interval '24 hours'
),
proposal_stats AS (
  SELECT
    count(*) FILTER (WHERE status = 'pending') as pending_proposals,
    count(*) FILTER (WHERE created_at > now() - interval '1 hour') as recent_proposals
  FROM ops_mission_proposals
  WHERE created_at > now() - interval '24 hours'
),
mission_stats AS (
  SELECT
    count(*) FILTER (WHERE status = 'running') as running_missions,
    count(*) FILTER (WHERE status = 'failed') as failed_missions
  FROM ops_missions
  WHERE created_at > now() - interval '24 hours'
),
step_stats AS (
  SELECT
    count(*) FILTER (WHERE status = 'queued') as queued_steps,
    count(*) FILTER (WHERE status = 'running') as running_steps,
    count(*) FILTER (WHERE status = 'failed') as failed_steps
  FROM ops_mission_steps
  WHERE created_at > now() - interval '24 hours'
)
SELECT
  event_stats.*,
  reaction_stats.*,
  proposal_stats.*,
  mission_stats.*,
  step_stats.*
FROM event_stats, reaction_stats, proposal_stats, mission_stats, step_stats;
```

**Recent Failures**
```sql
SELECT
  s.id as step_id,
  s.kind,
  s.executor,
  s.last_error,
  s.failure_count,
  s.updated_at,
  m.id as mission_id,
  p.source as proposal_source
FROM ops_mission_steps s
JOIN ops_missions m ON s.mission_id = m.id
LEFT JOIN ops_mission_proposals p ON m.proposal_id = p.id
WHERE s.status = 'failed'
AND s.updated_at > now() - interval '24 hours'
ORDER BY s.updated_at DESC
LIMIT 50;
```

**Policy Compliance**
```sql
SELECT
  'proposal_caps' as policy_type,
  (value->>'daily_limit')::int as daily_limit,
  (SELECT count(*) FROM ops_mission_proposals WHERE created_at > now() - interval '1 day') as current_usage
FROM ops_policy WHERE key = 'proposal_caps'
UNION ALL
SELECT
  'auto_approve' as policy_type,
  CASE WHEN (value->>'enabled')::boolean THEN 1 ELSE 0 END as enabled,
  (SELECT count(*) FROM ops_mission_proposals WHERE status = 'auto_approved' AND created_at > now() - interval '1 day') as auto_approved_count
FROM ops_policy WHERE key = 'auto_approve';
```

---

## 🚨 Incident Response Procedures

### Severity Levels

| Severity | Definition | Response Time | Examples |
|----------|------------|---------------|----------|
| **P0 - Critical** | Complete system outage | < 15 minutes | All workers down, database unreachable, no steps executing |
| **P1 - High** | Major functionality broken | < 1 hour | Heartbeat failing, 50%+ steps failing, proposal queue stuck |
| **P2 - Medium** | Partial degradation | < 4 hours | Single executor failing, elevated error rates, slow performance |
| **P3 - Low** | Minor issues | < 24 hours | Occasional failures, non-critical bugs, documentation updates |

### On-Call Procedures

#### Initial Response (All Severities)

1. **Acknowledge Alert**
   - Update incident status in tracking system
   - Post in designated channel (Slack, etc.)
   - Set estimated response time

2. **Gather Context**
   - Run diagnostic queries (see above)
   - Check recent deployments
   - Review logs (Vercel, worker, database)

3. **Assess Severity**
   - Determine impact to users/system
   - Classify as P0/P1/P2/P3
   - Escalate if needed

#### P0 - Critical Incident Playbook

**Examples:**
- All workers down
- Database connection failed
- No steps have executed in > 30 minutes
- Proposal queue not draining

**Immediate Actions (< 5 minutes):**

1. **Declare incident**
   ```bash
   # Update status
   echo "INCIDENT P0: System outage declared at $(date)" >> /var/log/ops-incidents.log
   ```

2. **Check database connectivity**
   ```sql
   -- From any machine with psql
   psql $SUPABASE_URL -c "SELECT now();"
   ```

3. **Check heartbeat health**
   ```bash
   curl -X POST \
     -H "Authorization: Bearer $OPS_API_KEY" \
     -H "Content-Type: application/json" \
     https://your-project.vercel.app/api/ops/heartbeat
   ```

4. **Check worker process**
   ```bash
   ps aux | grep "npm run worker"
   tail -100 /var/log/ops-worker.log
   ```

**Investigation (< 15 minutes):**

1. **If database down:**
   - Check Supabase status page
   - Contact Supabase support
   - Initiate failover if configured

2. **If Vercel down:**
   - Check Vercel status page
   - Verify deployment URL accessible
   - Check Vercel dashboard for errors

3. **If worker down:**
   - Restart worker process
   - Check for crashes in logs
   - Verify `.env` file exists and valid

**Recovery (< 30 minutes):**

1. **Restore service**
   - Restart failed components
   - Fix configuration issues
   - Clear stuck states

2. **Verify recovery**
   - Run diagnostic queries
   - Process test event
   - Monitor for 10 minutes

3. **Document incident**
   - Write postmortem
   - Update runbook with lessons learned
   - Create preventive measures

#### P1 - High Severity Playbook

**Examples:**
- Heartbeat failing but workers running
- > 50% steps failing
- Proposal queue growing without draining

**Immediate Actions (< 15 minutes):**

1. **Run diagnostics**
   ```sql
   -- System health
   -- (see System Health Overview query above)
   ```

2. **Identify bottleneck**
   - Check if events are being processed
   - Check if reactions are being created
   - Check if proposals are being created
   - Check if steps are being claimed

3. **Mitigate impact**
   - If queue depth high: scale workers
   - If error rate high: pause problematic executor
   - If caps hit: increase limits temporarily

**Investigation (< 1 hour):**

1. **Review logs for patterns**
   ```bash
   grep -i "error" /var/log/ops-worker.log | tail -100
   ```

2. **Check recent changes**
   - Recent deployments?
   - Policy changes?
   - Database schema changes?

3. **Test isolated components**
   - Test heartbeat alone
   - Test worker alone
   - Test specific executor

**Recovery (< 2 hours):**

1. **Fix root cause**
   - Rollback recent changes if needed
   - Fix configuration errors
   - Patch code bugs

2. **Monitor stability**
   - Watch metrics for 30 minutes
   - Ensure queue draining
   - Verify error rates normal

#### P2/P3 - Medium/Low Severity

**Follow standard troubleshooting guide** (see above)

### Escalation Paths

| Issue | Escalate To | When |
|-------|-------------|------|
| Database issues | Database team | Immediately for P0/P1 |
| Vercel issues | DevOps team | After 30min self-triage |
| Executor bugs | Development team | After identifying root cause |
| Policy questions | System owner | Within 24 hours |
| Security issues | Security team | Immediately |

### Incident Documentation Template

```markdown
# Incident Report [INC-XXXX]

## Summary
[Brief description of incident]

## Impact
- Severity: P0/P1/P2/P3
- Duration: [Start time] to [End time]
- Users affected: [Description]

## Timeline
- [Time]: Incident detected
- [Time]: Initial response started
- [Time]: Severity assessed
- [Time]: Mitigation applied
- [Time]: Service restored

## Root Cause
[What caused the incident]

## Resolution
[How it was fixed]

## Follow-up Actions
- [ ] [Action 1]
- [ ] [Action 2]
- [ ] [Action 3]

## Lessons Learned
[What can be improved]
```

---

## 💾 Backup and Recovery

### Supabase Automated Backups

**Supabase provides automated backups:**
- Daily backups retained for 7 days (free tier)
- Point-in-time recovery (PITR) available (Pro tier)
- Physical replication to standby (Enterprise tier)

**Verify backups are enabled:**
1. Navigate to Supabase Dashboard → Database → Backups
2. Confirm backup schedule is active
3. Test restore procedure in staging environment

### Manual Backup Procedures

**Export Current Schema:**
```bash
pg_dump $SUPABASE_URL \
  --schema-only \
  --no-owner \
  --no-privileges \
  > backup/schema_$(date +%Y%m%d).sql
```

**Export Policies:**
```bash
psql $SUPABASE_URL -c "COPY ops_policy TO STDOUT WITH CSV HEADER" \
  > backup/policies_$(date +%Y%m%d).csv
```

**Export Recent Data (last 7 days):**
```bash
pg_dump $SUPABASE_URL \
  --data-only \
  --table=ops_agent_events \
  --table=ops_mission_proposals \
  --table=ops_missions \
  --table=ops_mission_steps \
  --where="created_at > now() - interval '7 days'" \
  > backup/recent_data_$(date +%Y%m%d).sql
```

### Point-in-Time Recovery (PITR)

**If using Supabase Pro tier with PITR:**

1. Navigate to Supabase Dashboard → Database → Backups
2. Select "Time Travel" or "PITR"
3. Choose recovery point timestamp
4. Click "Restore to this time"
5. Confirm restoration (creates new database)

**Recover specific table:**
```sql
-- Restore from backup database
CREATE TABLE ops_mission_steps_backup AS
SELECT * FROM [recovery_db].ops_mission_steps;

-- Replace corrupted table
TRUNCATE ops_mission_steps;
INSERT INTO ops_mission_steps SELECT * FROM ops_mission_steps_backup;
```

### Disaster Recovery Testing

**Test disaster recovery quarterly:**

1. **Simulate database loss**
   ```bash
   # Create test database
   createdb ops_loop_dr_test

   # Restore from latest backup
   psql ops_loop_dr_test < backup/schema_latest.sql
   psql ops_loop_dr_test < backup/recent_data_latest.sql
   ```

2. **Verify data integrity**
   ```sql
   -- Connect to test database
   pql ops_loop_dr_test

   -- Run diagnostics
   SELECT
     (SELECT count(*) FROM ops_agent_events) as events,
     (SELECT count(*) FROM ops_mission_proposals) as proposals,
     (SELECT count(*) FROM ops_missions) as missions,
     (SELECT count(*) FROM ops_mission_steps) as steps;
   ```

3. **Document any issues** and update backup procedures

---

## 🔄 Rollback Procedures

### Vercel Deployment Rollback

**Instant Rollback (Zero-Downtime):**

1. Navigate to Vercel Dashboard → Deployments
2. Find previous stable deployment
3. Click "Promote to Production"
4. Verify: `curl` heartbeat endpoint returns 200

**Rollback via CLI:**
```bash
cd vercel

# List recent deployments
vercel ls

# Rollback to specific deployment
vercel rollback [deployment-url]

# Or promote specific deployment
vercel promote [deployment-url]
```

### Database Migration Rollback

**For additive changes (safe to rollback code):**
1. Deploy previous Vercel version
2. No database changes needed (new columns unused)

**For schema changes:**

**Option 1: Reverse Migration Script**
```sql
-- Create reverse migration before deploying
-- Example: Dropping a newly added column
ALTER TABLE ops_mission_steps DROP COLUMN new_field;
```

**Option 2: Restore from Backup**
```bash
# Stop all processes (heartbeat, worker)
crontab -e  # Comment out all ops-loop jobs

# Restore database
pg_restore -d $SUPABASE_URL backup/schema_pre_migration.sql

# Restart processes
crontab -e  # Uncomment jobs
```

**Option 3: Point-in-Time Recovery**
1. Use Supabase PITR to restore to pre-migration timestamp
2. Follow PITR procedures above

### Policy Rollback

**If policy change causes issues:**

```sql
-- View policy history (if you've been tracking)
SELECT
  key,
  version,
  updated_at,
  jsonb_pretty(value) as policy
FROM ops_policy_history
WHERE key = 'reaction_matrix'
ORDER BY updated_at DESC
LIMIT 10;

-- Or restore from manual backup
UPDATE ops_policy
SET value = '[backup_policy_json]'::jsonb
WHERE key = 'reaction_matrix';
```

### Emergency Shutdown

**If system must be stopped immediately:**

1. **Stop heartbeat**
   ```bash
   crontab -e  # Comment out heartbeat line
   pkill -f "npm run heartbeat"
   ```

2. **Stop worker**
   ```bash
   crontab -e  # Comment out worker line
   pkill -f "npm run worker"
   ```

3. **Stop Vercel endpoint** (if needed)
   ```bash
   # Rename file to disable endpoint
   cd vercel/pages/api/ops
   mv heartbeat.ts heartbeat.ts.disabled
   vercel deploy --prod
   ```

**To restore:**
1. Uncomment cron jobs
2. Re-enable Vercel endpoint
3. Restart processes

---

## 🧹 Maintenance Tasks

### Regular Maintenance Schedule

#### Daily
- [ ] Check system health dashboard (5 min)
- [ ] Review error logs (5 min)
- [ ] Verify cron jobs running (2 min)
- [ ] Check queue depths (2 min)

#### Weekly
- [ ] Review failed steps and dead letters (15 min)
- [ ] Check database storage usage (5 min)
- [ ] Review proposal patterns and adjust if needed (10 min)
- [ ] Test heartbeat endpoint (2 min)

#### Monthly
- [ ] Review and update policies (30 min)
- [ ] Archive old data (1 hour)
- [ ] Run database VACUUM ANALYZE (10 min)
- [ ] Review and rotate API keys (15 min)
- [ ] Test disaster recovery procedure (1 hour)

#### Quarterly
- [ ] Full security audit (2 hours)
- [ ] Performance review and optimization (2 hours)
- [ ] Documentation update (1 hour)
- [ ] Capacity planning review (1 hour)

### Log Rotation

**Configure logrotate for worker logs:**

Create `/etc/logrotate.d/ops-loop`:
```
/var/log/ops-*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        systemctl reload ops-loop > /dev/null 2>&1 || true
    endscript
}
```

**Test configuration:**
```bash
logrotate -d /etc/logrotate.d/ops-loop
```

### Database Maintenance

**Weekly VACUUM ANALYZE:**
```sql
VACUUM ANALYZE ops_agent_events;
VACUUM ANALYZE ops_agent_reactions;
VACUUM ANALYZE ops_mission_proposals;
VACUUM ANALYZE ops_missions;
VACUUM ANALYZE ops_mission_steps;
```

**Check table bloat:**
```sql
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size
FROM pg_tables
WHERE schemaname = 'public'
AND tablename LIKE 'ops_%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Data Retention and Archiving

**Archive old completed missions:**

```sql
-- Create archive table (one-time)
CREATE TABLE ops_mission_steps_archive (
  LIKE ops_mission_steps INCLUDING ALL
);

-- Archive steps older than 90 days
INSERT INTO ops_mission_steps_archive
SELECT * FROM ops_mission_steps
WHERE status IN ('succeeded', 'failed')
AND updated_at < now() - interval '90 days';

-- Delete archived steps
DELETE FROM ops_mission_steps
WHERE status IN ('succeeded', 'failed')
AND updated_at < now() - interval '90 days';
```

**Schedule:**
- Run monthly to keep tables manageable
- Adjust retention period based on compliance requirements

### Policy Review and Updates

**Review policies monthly:**

1. **Check proposal caps**
   ```sql
   SELECT jsonb_pretty(value) FROM ops_policy WHERE key = 'proposal_caps';
   ```
   Adjust if regularly hitting limits

2. **Review auto-approve rules**
   ```sql
   SELECT jsonb_pretty(value) FROM ops_policy WHERE key = 'auto_approve';
   ```
   Ensure appropriate for current risk tolerance

3. **Analyze reaction matrix effectiveness**
   ```sql
   SELECT
     jsonb_array_elements(value->'patterns')->>'name' as pattern_name,
     count(r.id) as reactions_created
   FROM ops_policy p
   CROSS JOIN ops_agent_reactions r
   WHERE p.key = 'reaction_matrix'
   AND r.created_at > now() - interval '30 days'
   GROUP BY 1
   ORDER BY 2 DESC;
   ```
   Remove unused patterns, adjust probability/cooldown

4. **Update agent models**
   ```sql
   SELECT jsonb_pretty(value) FROM ops_policy WHERE key = 'agent_roles';
   ```
   Review model choices and update if better versions available

---

## 🔒 Security Hardening

### API Key Management

**Generate secure API keys:**
```bash
# Generate 32-byte random key
openssl rand -base64 32
```

**Key rotation schedule:**
- Rotate `OPS_API_KEY` every 90 days
- Rotate `SUPABASE_SERVICE_ROLE_KEY` if compromised

**Rotation procedure:**
1. Generate new key
2. Update Vercel environment variable
3. Deploy to Vercel
4. Update worker `.env` file
5. Restart worker process
6. Retire old key after 24 hours

### Database Access Control

**Enable Row Level Security (RLS) in Supabase:**

```sql
-- Enable RLS on sensitive tables
ALTER TABLE ops_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_mission_proposals ENABLE ROW LEVEL SECURITY;

-- Create policy for service role only
CREATE POLICY "Service role only"
ON ops_policy
FOR ALL
TO service_role
USING (true);

-- Restrict API access
CREATE POLICY "No direct API access"
ON ops_policy
FOR ALL
TO anon
USING (false);
```

**Restrict network access:**
1. Navigate to Supabase Dashboard → Database → Connection Pooling
2. Add allowed IP addresses (Vercel IPs, worker IPs)
3. Block all other access

### Environment Variable Security

**Best practices:**
- [ ] Never commit `.env` files to git
- [ ] Use `.env.example` with placeholder values
- [ ] Store secrets in password manager (1Password, etc.)
- [ ] Use different keys for dev/staging/prod
- [ ] Rotate keys quarterly

**Example `.env.example`:**
```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# API Authentication
OPS_API_KEY=your-secure-random-api-key-here

# Worker Configuration
OPS_EVENT_BATCH_SIZE=50
OPS_REACTION_BATCH_SIZE=50
OPS_STEP_LEASE_MINUTES=5
OPS_WORKER_MAX_RETRIES=3
OPS_STALE_STEP_MINUTES=15
```

### Audit Logging

**Track all changes to policies:**
```sql
-- Create audit table
CREATE TABLE ops_policy_audit (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by text,
  changed_at timestamptz not null default now()
);

-- Create trigger function
CREATE OR REPLACE FUNCTION ops_audit_policy_update()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ops_policy_audit (policy_key, old_value, new_value, changed_by)
  VALUES (OLD.key, OLD.value, NEW.value, current_user);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER ops_policy_audit_trigger
AFTER UPDATE ON ops_policy
FOR EACH ROW
EXECUTE FUNCTION ops_audit_policy_update();
```

**Query audit log:**
```sql
SELECT
  policy_key,
  jsonb_pretty(old_value) as before,
  jsonb_pretty(new_value) as after,
  changed_by,
  changed_at
FROM ops_policy_audit
ORDER BY changed_at DESC
LIMIT 20;
```

### SSL/TLS Configuration

**Verify all connections use TLS:**
- Vercel → Supabase: Automatic (Supabase requires TLS)
- Worker → Supabase: Use `?sslmode=require` in connection string
- API clients: Enforce HTTPS only

**Example connection string:**
```
postgresql://postgres:[password]@nnmgddhlqfumlstopqxs.supabase.co:5432/postgres?sslmode=require
```

---

## 📝 Runbook Maintenance

### When to Update This Runbook

Update this document when:
- [ ] New deployment procedures are implemented
- [ ] New monitoring tools are added
- [ ] Common issues emerge that aren't documented
- [ ] Root cause analysis reveals new troubleshooting steps
- [ ] Security policies change
- [ ] Architecture changes affect operational procedures

### Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2025-01-21 | Initial creation | Ops Team |
| 1.1 | TBD | [Future updates] | [Author] |

---

## 🆘 Additional Resources

### Internal Resources
- [Architecture Deep Dive](ARCHITECTURE_DEEP_DIVE.md) - System architecture details
- [Policy Configuration](POLICY_CONFIGURATION.md) - Policy management
- [API Reference](API_REFERENCE.md) - Function and endpoint reference
- [Integration Guides](INTEGRATION_GUIDES.md) - Executor documentation

### External Resources
- [Supabase Documentation](https://supabase.com/docs)
- [Vercel Documentation](https://vercel.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

### Support Contacts
- **On-call Ops:** [Contact information]
- **Database Team:** [Contact information]
- **DevOps Team:** [Contact information]
- **Security Team:** [Contact information]

---

**Last Updated:** 2025-01-21
**Maintained By:** Operations Team
**Next Review:** 2025-04-21
