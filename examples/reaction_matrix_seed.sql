-- Reaction Matrix Policy Seed
-- Copy-paste this into Supabase SQL editor

-- Clear existing reaction matrix (optional)
DELETE FROM ops_policy WHERE key = 'reaction_matrix';

-- Insert reaction matrix
INSERT INTO ops_policy (key, value) VALUES (
  'reaction_matrix',
  jsonb_build_object(
    'patterns', jsonb_build_array(
      -- Pattern 1: Catch all events for testing
      jsonb_build_object(
        'id', 'catch-all-test',
        'event_type', '*',
        'probability', 1.0,
        'cooldown_minutes', 5,
        'source', 'trigger',
        'dedupe_key', 'catch-all-test',
        'template', jsonb_build_object(
          'title', 'Test reaction from event',
          'risk_level', 'low',
          'steps', jsonb_build_array(
            jsonb_build_object(
              'kind', 'noop',
              'executor', 'noop',
              'params', jsonb_build_object('note', 'This is a test step')
            )
          )
        )
      ),
      -- Pattern 2: Step failures trigger analysis
      jsonb_build_object(
        'id', 'analyze-failure',
        'event_type', jsonb_build_array('step:*:failed'),
        'probability', 0.8,
        'cooldown_minutes', 60,
        'source', 'reaction',
        'tags', jsonb_build_array('analysis'),
        'template', jsonb_build_object(
          'title', 'Analyze step failure',
          'risk_level', 'low',
          'steps', jsonb_build_array(
            jsonb_build_object(
              'kind', 'openclaw',
              'executor', 'openclaw',
              'params', jsonb_build_object(
                'subcommand', 'agent',
                'agent', 'analyst',
                'prompt', 'Review the failed step and suggest fixes'
              )
            )
          )
        )
      ),
      -- Pattern 3: Mission success triggers celebration/review
      jsonb_build_object(
        'id', 'celebrate-success',
        'event_type', 'mission:succeeded',
        'probability', 0.5,
        'cooldown_minutes', 30,
        'source', 'reaction',
        'template', jsonb_build_object(
          'title', 'Mission completed - review and celebrate',
          'risk_level', 'low',
          'steps', jsonb_build_array(
            jsonb_build_object(
              'kind', 'noop',
              'executor', 'noop',
              'params', jsonb_build_object('note', 'Mission completed successfully!')
            )
          )
        )
      )
    )
  )
);

-- Enable auto-approve for low-risk missions
INSERT INTO ops_policy (key, value) VALUES (
  'auto_approve',
  jsonb_build_object(
    'enabled', true,
    'allowed_step_kinds', jsonb_build_array('noop', 'openclaw')
  )
) ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  version = ops_policy.version + 1,
  updated_at = now();

-- Set proposal caps (optional - adjust as needed)
INSERT INTO ops_policy (key, value) VALUES (
  'proposal_caps',
  jsonb_build_object(
    'daily_limit', 100
  )
) ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  version = ops_policy.version + 1,
  updated_at = now();

-- Worker policy (safeguards)
INSERT INTO ops_policy (key, value) VALUES (
  'worker_policy',
  jsonb_build_object(
    'allowed_openclaw_subcommands', jsonb_build_array('agent'),
    'allowed_tools', jsonb_build_array(),
    'max_retries', 2,
    'openclaw_timeout_ms', 600000
  )
) ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  version = ops_policy.version + 1,
  updated_at = now();
