-- 0004_ops_voting_system.sql
-- Adds agent consensus (voting) capabilities to the Ops-Loop

-- 1. Add 'voting' status to proposals
ALTER TYPE ops_proposal_status ADD VALUE IF NOT EXISTS 'voting';

-- 2. Create Votes Table
CREATE TABLE IF NOT EXISTS ops_proposal_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES ops_mission_proposals(id) ON DELETE CASCADE,
  agent_role text NOT NULL, -- e.g., 'sage', 'observer'
  vote text NOT NULL CHECK (vote IN ('approve', 'reject', 'abstain')),
  reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(proposal_id, agent_role)
);

CREATE INDEX IF NOT EXISTS ops_proposal_votes_proposal_idx ON ops_proposal_votes(proposal_id);

-- 3. Default Voting Policy
INSERT INTO ops_policy (key, value)
VALUES (
  'voting_policy',
  '{
    "thresholds": {
      "low": 1,
      "medium": 2,
      "high": 3
    },
    "required_voters": ["sage", "observer", "architect"]
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- 4. Function: Check Consensus
CREATE OR REPLACE FUNCTION ops_check_consensus(p_proposal_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_risk_level text;
  v_policy jsonb;
  v_threshold integer;
  v_approvals integer;
  v_rejections integer;
BEGIN
  -- Get risk level from proposal template
  SELECT (template->>'risk_level') INTO v_risk_level 
  FROM ops_mission_proposals WHERE id = p_proposal_id;
  
  -- Get voting policy
  SELECT value INTO v_policy FROM ops_policy WHERE key = 'voting_policy';
  v_threshold := coalesce((v_policy->'thresholds'->>v_risk_level)::integer, 2);

  -- Count votes
  SELECT 
    count(*) FILTER (WHERE vote = 'approve'),
    count(*) FILTER (WHERE vote = 'reject')
  INTO v_approvals, v_rejections
  FROM ops_proposal_votes
  WHERE proposal_id = p_proposal_id;

  -- Evaluate
  IF v_rejections > 0 THEN
    UPDATE ops_mission_proposals SET status = 'rejected', reason = 'Vetoed by agent' WHERE id = p_proposal_id;
    RETURN jsonb_build_object('status', 'rejected', 'reason', 'veto');
  ELSIF v_approvals >= v_threshold THEN
    UPDATE ops_mission_proposals SET status = 'approved', approved_at = now() WHERE id = p_proposal_id;
    PERFORM ops_create_mission_from_proposal(p_proposal_id);
    RETURN jsonb_build_object('status', 'approved', 'approvals', v_approvals);
  END IF;

  RETURN jsonb_build_object('status', 'voting', 'approvals', v_approvals, 'threshold', v_threshold);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Function: Cast a Vote
CREATE OR REPLACE FUNCTION ops_cast_vote(
  p_proposal_id uuid,
  p_agent_role text,
  p_vote text,
  p_reason text DEFAULT NULL
) RETURNS jsonb AS $$
BEGIN
  INSERT INTO ops_proposal_votes (proposal_id, agent_role, vote, reason)
  VALUES (p_proposal_id, p_agent_role, p_vote, p_reason)
  ON CONFLICT (proposal_id, agent_role) 
  DO UPDATE SET vote = EXCLUDED.vote, reason = EXCLUDED.reason, created_at = now();

  RETURN ops_check_consensus(p_proposal_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;