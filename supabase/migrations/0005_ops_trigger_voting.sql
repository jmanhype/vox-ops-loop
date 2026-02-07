-- 0005_ops_trigger_voting.sql
-- Updates proposal creation to trigger the voting process for non-auto-approvable items

DROP FUNCTION IF EXISTS ops_create_proposal_and_maybe_autoapprove(text, text, jsonb);

CREATE OR REPLACE FUNCTION ops_create_proposal_and_maybe_autoapprove(
  p_dedupe_key text,
  p_source text,
  p_template jsonb
) returns table (
  r_proposal_id uuid, 
  r_status ops_proposal_status, 
  r_mission_id uuid, 
  r_reason text
) 
language plpgsql as $$
declare
  v_proposal_id uuid;
  v_status ops_proposal_status;
  v_mission_id uuid;
  v_gate_ok boolean;
  v_gate_reason text;
  v_policy_snapshot jsonb;
  v_risk text;
begin
  -- 1. Check dedupe
  if p_dedupe_key is not null then
    select p.id, p.status into v_proposal_id, v_status 
    from ops_mission_proposals p where p.dedupe_key = p_dedupe_key;
    if found then
      r_proposal_id := v_proposal_id;
      r_status := v_status;
      return next;
      return;
    end if;
  end if;

  -- 2. Snapshot policy
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_policy_snapshot from ops_policy;

  -- 3. Gate check
  select ok, reason into v_gate_ok, v_gate_reason from ops_gate_proposal(p_template);
  if not v_gate_ok then
    insert into ops_mission_proposals (dedupe_key, source, status, template, reason, policy_snapshot)
    values (p_dedupe_key, p_source, 'rejected', p_template, v_gate_reason, v_policy_snapshot)
    returning id into v_proposal_id;
    
    r_proposal_id := v_proposal_id;
    r_status := 'rejected';
    r_reason := v_gate_reason;
    return next;
    return;
  end if;

  -- 4. Check auto-approval
  if ops_is_auto_approvable(p_template) then
    insert into ops_mission_proposals (dedupe_key, source, status, template, policy_snapshot, approved_at)
    values (p_dedupe_key, p_source, 'auto_approved', p_template, v_policy_snapshot, now())
    returning id into v_proposal_id;
    
    select ops_create_mission_from_proposal(v_proposal_id) into v_mission_id;
    
    r_proposal_id := v_proposal_id;
    r_status := 'auto_approved';
    r_mission_id := v_mission_id;
    return next;
  else
    -- 5. Trigger Voting
    insert into ops_mission_proposals (dedupe_key, source, status, template, policy_snapshot)
    values (p_dedupe_key, p_source, 'voting', p_template, v_policy_snapshot)
    returning id into v_proposal_id;
    
    v_risk := coalesce(p_template->>'risk_level', 'medium');

    insert into ops_agent_events (type, data)
    values ('proposal:vote_requested', jsonb_build_object('proposal_id', v_proposal_id, 'risk_level', v_risk));

    r_proposal_id := v_proposal_id;
    r_status := 'voting';
    return next;
  end if;
end;
$$;
