-- Ops loop schema (minimal, canonical)
-- Requires: pgcrypto for gen_random_uuid()

create extension if not exists "pgcrypto";

-- Enum types
create type ops_proposal_status as enum (
  'pending',
  'approved',
  'rejected',
  'auto_approved'
);

create type ops_mission_status as enum (
  'approved',
  'running',
  'succeeded',
  'failed'
);

create type ops_step_status as enum (
  'queued',
  'running',
  'succeeded',
  'failed'
);

create type ops_action_run_status as enum (
  'started',
  'succeeded',
  'failed'
);

-- Policies (key/value)
create table if not exists ops_policy (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

-- Proposals
create table if not exists ops_mission_proposals (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text unique,
  source text not null check (source in ('api','trigger','reaction','manual')),
  status ops_proposal_status not null,
  template jsonb not null,
  reason text,
  policy_snapshot jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ops_mission_proposals_status_idx
  on ops_mission_proposals (status, created_at desc);

-- Missions
create table if not exists ops_missions (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references ops_mission_proposals (id) on delete set null,
  status ops_mission_status not null,
  policy_snapshot jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ops_missions_status_idx
  on ops_missions (status, created_at desc);

-- Steps
create table if not exists ops_mission_steps (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references ops_missions (id) on delete cascade,
  kind text not null,
  params jsonb not null default '{}'::jsonb,
  status ops_step_status not null,
  executor text,
  reserved_at timestamptz,
  lease_expires_at timestamptz,
  failure_count integer not null default 0,
  max_retries integer,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ops_mission_steps_status_idx
  on ops_mission_steps (status, reserved_at);

create index if not exists ops_mission_steps_mission_idx
  on ops_mission_steps (mission_id, status);

-- Events
create table if not exists ops_agent_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text unique,
  type text not null,
  data jsonb not null,
  mission_id uuid references ops_missions (id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ops_agent_events_type_idx
  on ops_agent_events (type, processed_at);

-- Reaction queue (optional)
create table if not exists ops_agent_reactions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references ops_agent_events (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','done','failed')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ops_agent_reactions_status_idx
  on ops_agent_reactions (status, created_at);

-- Action runs (observability)
create table if not exists ops_action_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text unique,
  step_id uuid references ops_mission_steps (id) on delete set null,
  executor text,
  status ops_action_run_status not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  meta jsonb,
  error text
);

create index if not exists ops_action_runs_step_idx
  on ops_action_runs (step_id, started_at desc);
