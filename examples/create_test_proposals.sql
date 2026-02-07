-- Manual Proposal Creation Examples
-- Copy these SQL statements to create test proposals

-- Example 1: Simple no-op (auto-approved)
SELECT ops_create_proposal_and_maybe_autoapprove(
  'test-noop-' || extract(epoch from now())::bigint,
  'manual_test',
  jsonb_build_object(
    'title', 'Test no-op execution',
    'risk_level', 'low',
    'steps', jsonb_build_array(
      jsonb_build_object(
        'kind', 'noop',
        'executor', 'noop',
        'params', jsonb_build_object('note', 'This is a test step')
      )
    )
  )
);

-- Example 2: OpenClaw agent step (auto-approved)
SELECT ops_create_proposal_and_maybe_autoapprove(
  'test-agent-' || extract(epoch from now())::bigint,
  'manual_test',
  jsonb_build_object(
    'title', 'Run OpenClaw agent',
    'risk_level', 'low',
    'steps', jsonb_build_array(
      jsonb_build_object(
        'kind', 'openclaw',
        'executor', 'openclaw',
        'params', jsonb_build_object(
          'subcommand', 'agent',
          'agent', 'main',
          'prompt', 'Say hello from the ops loop!',
          'thinking', 'low'
        )
      )
    )
  )
);

-- Example 3: Multi-step workflow
SELECT ops_create_proposal_and_maybe_autoapprove(
  'test-multi-' || extract(epoch from now())::bigint,
  'manual_test',
  jsonb_build_object(
    'title', 'Multi-step test workflow',
    'risk_level', 'low',
    'steps', jsonb_build_array(
      jsonb_build_object(
        'kind', 'noop',
        'executor', 'noop',
        'params', jsonb_build_object('note', 'Step 1: Initialize')
      ),
      jsonb_build_object(
        'kind', 'openclaw',
        'executor', 'openclaw',
        'params', jsonb_build_object(
          'subcommand', 'agent',
          'agent', 'main',
          'prompt', 'What time is it?',
          'thinking': 'low'
        )
      ),
      jsonb_build_object(
        'kind', 'noop',
        'executor', 'noop',
        'params', jsonb_build_object('note', 'Step 3: Cleanup')
      )
    )
  )
);

-- Example 4: Create event that triggers reaction
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

-- Query to check all proposals
SELECT
  id,
  status,
  source,
  jsonb_pretty(template) as proposal_template,
  created_at
FROM ops_mission_proposals
ORDER BY created_at DESC
LIMIT 10;

-- Query to check all missions
SELECT
  m.id,
  m.status,
  p.status as proposal_status,
  p.template->>'title' as title,
  m.started_at,
  m.completed_at
FROM ops_missions m
LEFT JOIN ops_mission_proposals p ON m.proposal_id = p.id
ORDER BY m.created_at DESC
LIMIT 10;

-- Query to check mission steps
SELECT
  s.id,
  s.kind,
  s.status,
  s.failure_count,
  s.last_error,
  jsonb_pretty(s.result) as result,
  s.created_at
FROM ops_mission_steps s
JOIN ops_missions m ON s.mission_id = m.id
ORDER BY s.created_at DESC
LIMIT 20;

-- Query to check reaction queue
SELECT
  r.id,
  r.status,
  r.payload,
  r.created_at
FROM ops_agent_reactions r
ORDER BY r.created_at DESC
LIMIT 10;

-- Query to check dead letters (failed steps)
SELECT
  dl.id,
  dl.kind,
  dl.failure_count,
  dl.last_error,
  jsonb_pretty(dl.result) as result,
  dl.created_at
FROM ops_step_dead_letters dl
ORDER BY dl.created_at DESC
LIMIT 10;
