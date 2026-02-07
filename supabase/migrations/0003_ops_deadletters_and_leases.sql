-- Dead letters and lease expiry recovery

create table if not exists ops_step_dead_letters (
  id uuid primary key default gen_random_uuid(),
  step_id uuid references ops_mission_steps (id) on delete set null,
  mission_id uuid references ops_missions (id) on delete set null,
  kind text,
  params jsonb,
  executor text,
  failure_count integer,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ops_step_dead_letters_mission_idx
  on ops_step_dead_letters (mission_id, created_at desc);

create index if not exists ops_agent_reactions_pattern_idx
  on ops_agent_reactions ((payload->>'pattern_id'));

-- Recover steps with expired leases.
create or replace function ops_recover_expired_leases()
returns table (requeued_steps integer, failed_steps integer)
language plpgsql as $$
declare
  v_requeued integer;
  v_failed integer;
  v_mission_id uuid;
begin
  with expired as (
    select id, mission_id, failure_count, max_retries
    from ops_mission_steps
    where status = 'running'
      and lease_expires_at is not null
      and lease_expires_at < now()
    for update
  ), updated as (
    update ops_mission_steps s
      set status = case
            when s.max_retries is not null and (s.failure_count + 1) >= s.max_retries then 'failed'
            else 'queued'
          end,
          failure_count = s.failure_count + 1,
          last_error = 'Lease expired',
          reserved_at = null,
          lease_expires_at = null
    from expired
    where s.id = expired.id
    returning s.mission_id, s.status
  )
  select
    count(*) filter (where status = 'queued'),
    count(*) filter (where status = 'failed')
    into v_requeued, v_failed
  from updated;

  for v_mission_id in (select distinct mission_id from updated where status = 'failed') loop
    perform ops_maybe_finalize_mission(v_mission_id);
  end loop;

  requeued_steps := coalesce(v_requeued, 0);
  failed_steps := coalesce(v_failed, 0);
  return next;
end;
$$;
