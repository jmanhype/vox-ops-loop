-- Ops loop functions

-- updated_at trigger helper
create or replace function ops_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'ops_missions_set_updated_at'
  ) then
    create trigger ops_missions_set_updated_at
      before update on ops_missions
      for each row execute function ops_set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'ops_mission_steps_set_updated_at'
  ) then
    create trigger ops_mission_steps_set_updated_at
      before update on ops_mission_steps
      for each row execute function ops_set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'ops_agent_reactions_set_updated_at'
  ) then
    create trigger ops_agent_reactions_set_updated_at
      before update on ops_agent_reactions
      for each row execute function ops_set_updated_at();
  end if;
end $$;

-- Extract step kinds from proposal template
create or replace function ops_extract_step_kinds(p_template jsonb)
returns text[] language sql as $$
  select array_agg(distinct step->>'kind')
  from jsonb_array_elements(coalesce(p_template->'steps','[]'::jsonb)) as step
  where step ? 'kind';
$$;

-- Gate checks (caps / quotas). Extend as needed.
create or replace function ops_gate_proposal(p_template jsonb)
returns table (ok boolean, reason text) language plpgsql as $$
declare
  v_caps jsonb;
  v_daily_limit integer;
  v_count integer;
begin
  select value into v_caps from ops_policy where key = 'proposal_caps';

  if v_caps is not null then
    v_daily_limit := nullif((v_caps->>'daily_limit')::integer, 0);
    if v_daily_limit is not null then
      select count(*) into v_count
      from ops_mission_proposals
      where created_at >= date_trunc('day', now());

      if v_count >= v_daily_limit then
        ok := false;
        reason := 'Daily proposal cap reached';
        return next;
        return;
      end if;
    end if;
  end if;

  ok := true;
  reason := null;
  return next;
end;
$$;

-- Auto-approve checks. Extend as needed.
create or replace function ops_is_auto_approvable(p_template jsonb)
returns boolean language plpgsql as $$
declare
  v_policy jsonb;
  v_enabled boolean;
  v_allowed jsonb;
  v_step_kinds text[];
  v_kind text;
begin
  select value into v_policy from ops_policy where key = 'auto_approve';

  if v_policy is null then
    return false;
  end if;

  v_enabled := coalesce((v_policy->>'enabled')::boolean, false);
  if v_enabled is false then
    return false;
  end if;

  v_allowed := v_policy->'allowed_step_kinds';
  if v_allowed is null then
    return true; -- enabled, no restrictions
  end if;

  v_step_kinds := ops_extract_step_kinds(p_template);
  if v_step_kinds is null or array_length(v_step_kinds, 1) is null then
    return false;
  end if;

  foreach v_kind in array v_step_kinds loop
    if not (v_allowed ? v_kind) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

-- Create mission + steps from a proposal template
create or replace function ops_create_mission_from_proposal(p_proposal_id uuid)
returns uuid language plpgsql as $$
declare
  v_template jsonb;
  v_policy_snapshot jsonb;
  v_mission_id uuid;
begin
  select template, policy_snapshot
    into v_template, v_policy_snapshot
    from ops_mission_proposals
    where id = p_proposal_id;

  if v_template is null then
    raise exception 'Proposal % not found', p_proposal_id;
  end if;

  insert into ops_missions (proposal_id, status, policy_snapshot, started_at)
  values (p_proposal_id, 'approved', v_policy_snapshot, now())
  returning id into v_mission_id;

  -- Insert steps from template.steps
  insert into ops_mission_steps (mission_id, kind, params, status, executor)
  select
    v_mission_id,
    step->>'kind',
    coalesce(step->'params','{}'::jsonb),
    'queued',
    coalesce(step->>'executor', 'openclaw')
  from jsonb_array_elements(coalesce(v_template->'steps','[]'::jsonb)) as step
  where step ? 'kind';

  return v_mission_id;
end;
$$;

-- Proposal entry point: cap gates + auto-approve + mission creation
create or replace function ops_create_proposal_and_maybe_autoapprove(
  p_dedupe_key text,
  p_source text,
  p_template jsonb
)
returns table (proposal_id uuid, proposal_status ops_proposal_status, mission_id uuid, proposal_reason text)
language plpgsql as $$
declare
  v_existing_id uuid;
  v_existing_status ops_proposal_status;
  v_gate_ok boolean;
  v_gate_reason text;
  v_policy_snapshot jsonb;
  v_auto boolean;
  v_mission_id uuid;
  v_proposal_id uuid;
  v_proposal_status ops_proposal_status;
begin
  if p_dedupe_key is not null then
    select id, status into v_existing_id, v_existing_status
    from ops_mission_proposals where dedupe_key = p_dedupe_key;

    if v_existing_id is not null then
      v_proposal_id := v_existing_id;
      v_proposal_status := v_existing_status;
      v_mission_id := null;
      v_proposal_reason := null;
      return next;
      return;
    end if;
  end if;

  -- Snapshot policy at time of proposal
  select jsonb_object_agg(key, value) into v_policy_snapshot from ops_policy;

  select ok, reason into v_gate_ok, v_gate_reason from ops_gate_proposal(p_template);

  if v_gate_ok is false then
    insert into ops_mission_proposals (dedupe_key, source, status, template, reason, policy_snapshot)
    values (p_dedupe_key, p_source, 'rejected', p_template, v_gate_reason, v_policy_snapshot)
    returning id into v_proposal_id;
    v_proposal_status := 'rejected';
    v_mission_id := null;
    v_proposal_reason := v_gate_reason;
    return next;
    return;
  end if;

  insert into ops_mission_proposals (dedupe_key, source, status, template, policy_snapshot)
  values (p_dedupe_key, p_source, 'pending', p_template, v_policy_snapshot)
  returning id into v_proposal_id;
    v_proposal_status := 'pending';

  v_auto := ops_is_auto_approvable(p_template);

  if v_auto is true then
    update ops_mission_proposals
      set status = 'auto_approved', approved_at = now()
      where id = v_proposal_id
      returning status into v_proposal_status;
    v_proposal_status := 'auto_approved';
    v_mission_id := ops_create_mission_from_proposal(v_proposal_id);
  else
    v_mission_id := null;
  end if;

  v_proposal_reason := null;
  return next;
end;
$$;

-- Finalize mission based on steps
create or replace function ops_maybe_finalize_mission(p_mission_id uuid)
returns void language plpgsql as $$
declare
  v_failed integer;
  v_remaining integer;
begin
  select count(*) filter (where status = 'failed'),
         count(*) filter (where status in ('queued','running'))
    into v_failed, v_remaining
  from ops_mission_steps
  where mission_id = p_mission_id;

  if v_failed > 0 then
    update ops_missions
      set status = 'failed', completed_at = now()
      where id = p_mission_id and status <> 'failed';
    return;
  end if;

  if v_remaining = 0 then
    update ops_missions
      set status = 'succeeded', completed_at = now()
      where id = p_mission_id and status <> 'succeeded';
  end if;
end;
$$;

-- Recover steps with expired leases.
create or replace function ops_recover_expired_leases()
returns table (requeued_steps integer, failed_steps integer)
language plpgsql as $$
declare
  v_step RECORD;
  v_requeued integer := 0;
  v_failed integer := 0;
BEGIN
  FOR v_step IN
    SELECT id, mission_id, failure_count, max_retries
    FROM ops_mission_steps
    WHERE status = 'running'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at < now()
    FOR UPDATE
  LOOP
    IF v_step.max_retries IS NOT NULL AND (v_step.failure_count + 1) >= v_step.max_retries THEN
      UPDATE ops_mission_steps
        SET status = 'failed',
            failure_count = v_step.failure_count + 1,
            last_error = 'Lease expired',
            reserved_at = NULL,
            lease_expires_at = NULL
        WHERE id = v_step.id;
      v_failed := v_failed + 1;
      PERFORM ops_maybe_finalize_mission(v_step.mission_id);
    ELSE
      UPDATE ops_mission_steps
        SET status = 'queued',
            failure_count = v_step.failure_count + 1,
            last_error = 'Lease expired',
            reserved_at = NULL,
            lease_expires_at = NULL
        WHERE id = v_step.id;
      v_requeued := v_requeued + 1;
    END IF;
  END LOOP;

  RETURN NEXT;
END;
$$;

-- Claim next queued step (atomic)
create or replace function ops_claim_next_step(p_lease_minutes integer)
returns setof ops_mission_steps
language plpgsql as $$
declare
  v_step ops_mission_steps%rowtype;
begin
  with candidate as (
    select id
    from ops_mission_steps
    where status = 'queued'
    order by created_at asc
    limit 1
    for update skip locked
  )
  update ops_mission_steps s
    set status = 'running',
        reserved_at = now(),
        lease_expires_at = now() + make_interval(mins => p_lease_minutes)
  from candidate
  where s.id = candidate.id
  returning s.* into v_step;

  if not found then
    return;
  end if;

  return next v_step;
end;
$$;
