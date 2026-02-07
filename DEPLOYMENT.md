# Vercel Deployment Plan

> **📚 For comprehensive operations documentation, see [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md)**

## ✅ Pre-Deployment Checklist

### Environment
- [ ] Vercel account configured and verified
- [ ] Supabase project created (URL: https://nnmgddhlqfumlstopqxs.supabase.co)
- [ ] Local development environment tested
- [ ] All migrations tested locally
- [ ] Environment variables documented

### Security
- [ ] Strong `OPS_API_KEY` generated (32+ characters, random)
- [ ] Supabase Service Role Key secured (not committed to git)
- [ ] Database RLS policies enabled
- [ ] API access limited to authorized users
- [ ] HTTPS enforced on all endpoints

### Data
- [ ] Database migrations tested on staging
- [ ] Backup strategy confirmed
- [ ] Initial policies seeded
- [ ] Test data removed or isolated
- [ ] Point-in-time recovery enabled (Supabase)

### Monitoring
- [ ] Logging configured in heartbeat endpoint
- [ ] Error tracking setup (Vercel analytics)
- [ ] Dashboard queries prepared
- [ ] Alert thresholds defined
- [ ] On-call contact established

### Testing
- [ ] All SQL functions tested
- [ ] Heartbeat endpoint tested locally
- [ ] Worker process tested locally
- [ ] Reaction matrix validated
- [ ] Auto-approval rules verified

## Prerequisites
- Vercel account configured
- Supabase URL: https://nnmgddhlqfumlstopqxs.supabase.co
- Supabase Service Role Key: Set as env var in Vercel

## Required Environment Variables (Vercel)
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (NOT anon key)
- `OPS_API_KEY` - Bearer token for heartbeat endpoint

## Deploy Steps

### 1. Test Locally First
```bash
cd vercel/pages/api/ops
node heartbeat.ts
```

Expected: JSON response with trigger/reaction stats

### 2. Deploy to Vercel
```bash
cd /Users/speed/.openclaw/workspace/ops-loop/vercel
vercel deploy --prod
```

### 3. Set Environment Variables in Vercel Dashboard
Go to: https://vercel.com/[your-project]/settings/environment-variables

Add:
- `SUPABASE_URL=https://nnmgddhlqfumlstopqxs.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ubWdkZGhscWZ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDQ0NTk3NSwiZXhwIjoyMDg2MDIxOTc1NX0.GP36jN0XiKnpagShjzA4XCJLttns_czjYLIeNpacIVU`
- `OPS_API_KEY=some-secure-random-string`

### 4. Test Deployed Endpoint
```bash
curl -X POST \
  -H "Authorization: Bearer OPS_API_KEY" \
  -H "Content-Type: application/json" \
  https://your-project.vercel.app/api/ops/heartbeat
```

Expected: Same JSON response as local test

### 5. Update Local Worker Cron
The heartbeat will now run on Vercel. Remove from local crontab:

```bash
crontab -e
# Remove any existing ops-loop heartbeat
*/5 * * * * cd /Users/speed/.openclaw/workspace/ops-loop/local && npm run heartbeat
*/1 * * * * cd /Users/speed/.openclaw/workspace/ops-loop/local && npm run worker
```

Keep worker on local (or move to VPS later).

## 🔄 Rollback Procedures

### Vercel Deployment Rollback

If issues are detected after deployment:

```bash
# List recent deployments
vercel ls

# Rollback to previous deployment
vercel rollback [deployment-url]

# Or promote a previous deployment
vercel promote [deployment-url] --scope [your-team]
```

### Database Migration Rollback

If schema changes cause issues:

```bash
# 1. Stop the worker (prevent new steps)
# Kill worker process or disable cron

# 2. Identify the problematic migration
psql -c "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 5;"

# 3. Manually revert changes (example)
psql -f supabase/migrations/rollback/0003_revert_changes.sql

# 4. Verify system health
# Check ops_mission_steps for stuck steps
# Check ops_action_runs for errors
```

### Policy Revert

If new policies cause unexpected behavior:

```sql
-- View policy history (if you have versioning)
SELECT * FROM ops_policy_history WHERE key = 'reaction_matrix' ORDER BY changed_at DESC LIMIT 10;

-- Revert to previous policy
UPDATE ops_policy
SET value = '[previous_policy_json]'::jsonb
WHERE key = 'reaction_matrix';

-- Or restore from backup
-- (assuming you have a backup table)
INSERT INTO ops_policy (key, value)
SELECT key, value FROM ops_policy_backup
WHERE key = 'reaction_matrix';
```

### Emergency Shutdown

If critical issues require full system stop:

```bash
# 1. Stop Vercel deployment (prevent new heartbeat calls)
vercel rm [project-name] --yes --scope [your-team]

# 2. Stop local worker
pkill -f "node.*worker.mjs"

# 3. Disable all cron jobs
crontab -l | grep -v ops-loop | crontab -

# 4. Put Supabase in read-only mode (if needed)
# Via Supabase dashboard: Settings → Database → Enable Read-only mode
```

## 🔒 Production Hardening

### API Security

1. **Strong API Keys**
   ```bash
   # Generate a secure API key
   openssl rand -base64 32
   ```

2. **Rate Limiting** (Add to Vercel route)
   ```typescript
   // In heartbeat.ts or middleware
   const rateLimit = {
     windowMs: 60 * 1000, // 1 minute
     max: 100 // limit each IP to 100 requests per windowMs
   };
   ```

3. **Request Validation**
   ```typescript
   // Validate authorization header
   const authHeader = req.headers.authorization;
   if (!authHeader?.startsWith('Bearer ')) {
     return res.status(401).json({ error: 'Unauthorized' });
   }
   ```

### Database Security

1. **Row Level Security (RLS)**
   ```sql
   -- Enable RLS on sensitive tables
   ALTER TABLE ops_policy ENABLE ROW LEVEL SECURITY;

   -- Create policy (example)
   CREATE POLICY policy_read_only ON ops_policy
     FOR SELECT USING (true);
   ```

2. **Connection Pooling**
   - Use Supabase's connection pooling
   - Set appropriate pool sizes
   - Monitor connection count

3. **Backup Verification**
   ```bash
   # Test restore procedure quarterly
   # See OPERATIONS_RUNBOOK.md → Backup and Recovery
   ```

### Environment Variable Security

1. **Never commit secrets**
   ```bash
   # Add to .gitignore
   .env
   .env.local
   .env.production
   ```

2. **Use Vercel Environment Variables**
   - Store secrets in Vercel dashboard
   - Use different values for preview/production
   - Rotate keys quarterly

3. **Audit Access**
   - Review who has access to Vercel project
   - Review who has access to Supabase dashboard
   - Remove old API keys and tokens

## 📊 Monitoring Setup

### Supabase Dashboard Queries

**Key Metrics to Track:**

```sql
-- Proposal creation rate (last 24 hours)
SELECT
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as proposals
FROM ops_mission_proposals
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;

-- Mission success rate
SELECT
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM ops_missions
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY status;

-- Step failure rate
SELECT
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) FILTER (WHERE status = 'succeeded') as succeeded,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'failed')::NUMERIC /
    NULLIF(COUNT(*) FILTER (WHERE status != 'pending'), 0) * 100,
    2
  ) as failure_rate
FROM ops_mission_steps
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Dead letter accumulation
SELECT
  DATE_TRUNC('day', created_at) as day,
  COUNT(*) as dead_letters
FROM ops_step_dead_letters
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY day
ORDER BY day DESC;

-- Worker activity
SELECT
  action,
  COUNT(*) as executions,
  MAX(created_at) as last_run
FROM ops_action_runs
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY action;
```

### Vercel Analytics

1. **Enable Vercel Analytics**
   ```bash
   vercel analytics enable
   ```

2. **Monitor Key Metrics**
   - Response time (should be < 500ms for heartbeat)
   - Error rate (should be < 1%)
   - Request count (track heartbeat frequency)

3. **Set Up Alerts**
   - Response time > 2s
   - Error rate > 5%
   - 4xx/5xx errors spike

### Alert Thresholds

Configure alerts for:

| Metric | Warning | Critical |
|--------|---------|----------|
| Heartbeat response time | > 1s | > 3s |
| Proposal creation rate | < 1/hour | < 1/day |
| Mission success rate | < 80% | < 50% |
| Step failure rate | > 10% | > 25% |
| Dead letters | > 10/day | > 50/day |
| Worker downtime | > 5 min | > 15 min |

### Logging

1. **Structured Logging**
   ```typescript
   // In heartbeat.ts
   console.log(JSON.stringify({
     timestamp: new Date().toISOString(),
     event: 'heartbeat_processed',
     events_count: events.length,
     reactions_created: reactions.length,
     duration_ms: processingTime
   }));
   ```

2. **Log Aggregation**
   - Use Vercel logs for HTTP endpoint
   - Use worker logs for local process
   - Consider log forwarding (e.g., Datadog, LogRocket)

3. **Log Retention**
   - Vercel: Retains logs for 14 days (free), 30 days (pro)
   - Local worker: Configure log rotation in systemd/cron

### Health Check Endpoint

Create a simple health check:

```typescript
// vercel/pages/api/ops/health.ts
export default function handler(req, res) {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  };
  res.status(200).json(health);
}
```

Call regularly: `curl https://your-project.vercel.app/api/ops/health`
