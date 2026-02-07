# Ops Loop Blueprint (OpenClaw + Supabase + Vercel)

This folder contains **SQL migrations** and **Next.js API route stubs** for the closed-loop architecture described in the article.

## 📚 Documentation

**Comprehensive documentation suite available in [docs/](docs/)**

- **[System Overview](docs/SYSTEM_OVERVIEW.md)** - Executive summary and business context
- **[Architecture Deep Dive](docs/ARCHITECTURE_DEEP_DIVE.md)** - Technical architecture and data flow
- **[Agent Guide](docs/AGENT_GUIDE.md)** - All 6 agent roles and configuration
- **[Developer Onboarding](docs/DEVELOPER_ONBOARDING.md)** - Setup and local development
- **[Policy Configuration](docs/POLICY_CONFIGURATION.md)** - Policy reference and examples
- **[Operations Runbook](docs/OPERATIONS_RUNBOOK.md)** - Deployment, monitoring, troubleshooting
- **[API Reference](docs/API_REFERENCE.md)** - Complete API documentation
- **[Integration Guides](docs/INTEGRATION_GUIDES.md)** - Executor integration and development

**Quick Navigation**: See [docs/INDEX.md](docs/INDEX.md) for recommended reading paths by role.

## 🚀 Quick Start

1. **Set up Supabase**: Run migrations in `supabase/migrations/`
2. **Configure Vercel**: Set environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPS_API_KEY`)
3. **Deploy control plane**: Deploy `vercel/` to Vercel
4. **Run local worker**: `cd local && npm install && npm run worker`

**Detailed setup**: See [Developer Onboarding](docs/DEVELOPER_ONBOARDING.md)

## Contents

- `supabase/migrations/0001_ops_schema.sql` – core tables + enums
- `supabase/migrations/0002_ops_functions.sql` – proposal entrypoint, auto-approve, gates, stale recovery
- `vercel/pages/api/ops/*.ts` – control-plane routes (heartbeat, create-proposal, manual-approve, update-policy)
- `vercel/lib/ops/*.ts` – Supabase admin client + auth helper

## Environment Variables (Vercel)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPS_API_KEY` (Bearer token for control-plane routes)

## Notes

- The SQL functions are intentionally minimal and safe. Extend `ops_gate_proposal()` and `ops_is_auto_approvable()` to reflect your real policies.
- `ops_create_proposal_and_maybe_autoapprove()` is the single entry point for all proposal creation.
- Heartbeat route intentionally avoids execution; it only triggers lightweight control-plane tasks.

## Example Proposal Template

```json
{
  "title": "Draft and post a tweet",
  "risk_level": "low",
  "steps": [
    { "kind": "draft_tweet", "params": { "topic": "launch" }, "executor": "openclaw" },
    { "kind": "post_tweet", "params": { "draft_id": "..." }, "executor": "openclaw" }
  ]
}
```

## Local-First Execution (No VPS yet)

You can run the control-plane heartbeat and worker locally:

```bash
cd /Users/speed/.openclaw/workspace/ops-loop/local
npm install
cp .env.example .env
# set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
npm run heartbeat
npm run worker
```

Suggested crontab (local machine):

```
*/5 * * * * cd /Users/speed/.openclaw/workspace/ops-loop/local && npm run heartbeat
*/1 * * * * cd /Users/speed/.openclaw/workspace/ops-loop/local && npm run worker
```

For Wreckit-backed steps, set `executor: "wreckit"` and pass `params.command` + `params.id`.

### OpenClaw Executor

Use `executor: "openclaw"` with `params.subcommand` (default: `agent`) and `params.args`.
The worker enforces `worker_policy.allowed_openclaw_subcommands` (default: `["agent"]`) and optionally
`worker_policy.allowed_tools`. The `tools` list is used for gating only; include
any CLI flags you need in `params.args`.

Example step:

```json
{
  "kind": "openclaw",
  "executor": "openclaw",
  "params": {
    "subcommand": "agent",
    "agent": "editor",
    "prompt": "Summarize the latest changes",
    "thinking": "medium",
    "args": ["--deliver"],
    "tools": ["browser", "files"],
    "cwd": "/Users/speed/projects/my-app"
  }
}
```

### Reaction Matrix Policy (Triggers → Reactions)

Define `reaction_matrix` in `ops_policy` to generate queued reactions from events:

```json
{
  "patterns": [
    {
      "id": "tweet-viral",
      "event_type": "tweet:posted",
      "probability": 0.3,
      "cooldown_minutes": 120,
      "source": "trigger",
      "template": {
        "title": "Analyze viral tweet",
        "steps": [
          { "kind": "openclaw", "executor": "openclaw", "params": { "subcommand": "agent", "agent": "analyst", "prompt": "Analyze engagement spike" } }
        ]
      }
    }
  ]
}
```

The heartbeat creates queued entries in `ops_agent_reactions`. The reaction processor
turns those into proposals via `ops_create_proposal_and_maybe_autoapprove`.

### Dead Letters

Permanent step failures are written to `ops_step_dead_letters` so you can inspect
and retry manually.

## 🔧 Troubleshooting

### Common Issues

**Issue**: Worker not claiming steps
- Check worker is running: `ps aux | grep worker`
- Verify database connection in `.env`
- Check for unclaimed steps: `SELECT * FROM ops_mission_steps WHERE status = 'pending';`

**Issue**: Proposals not auto-approving
- Check `ops_policy` for `auto_approve` settings
- Verify step kinds are in `allowed_step_kinds`
- Check proposal caps in `ops_policy`

**Issue**: Reaction matrix not firing
- Verify pattern syntax in `reaction_matrix`
- Check event type matches pattern
- Review cooldown periods
- Enable debug logging in heartbeat

**Issue**: OpenClaw timeout
- Increase `openclaw_timeout_ms` in `worker_policy`
- Simplify agent task
- Check agent model selection

**More help**: See [Operations Runbook → Troubleshooting](docs/OPERATIONS_RUNBOOK.md#troubleshooting-guide) for comprehensive troubleshooting procedures, diagnostic queries, and error codes.
