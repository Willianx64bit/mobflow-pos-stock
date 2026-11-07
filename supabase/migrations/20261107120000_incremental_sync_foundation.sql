-- Incremental synchronization foundation for MobFlow PDV.
-- Additive only: this migration does not alter app_state, enable triggers,
-- publish tables to Realtime, or change client behavior.
-- Apply only after the schema/RLS review and staging validation.

create table if not exists public.sync_account_counters (
  account_id uuid primary key,
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_events (
  account_id uuid not null,
  sequence bigint not null check (sequence > 0),
  event_id uuid not null default gen_random_uuid(),
  channel text not null check (channel in ('stock_price', 'manual')),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (account_id, sequence),
  unique (event_id)
);

create index if not exists sync_events_account_created_idx
  on public.sync_events (account_id, created_at);

create table if not exists public.sync_notifications (
  account_id uuid not null,
  sequence bigint not null check (sequence > 0),
  channel text not null check (channel in ('stock_price', 'manual')),
  created_at timestamptz not null default now(),
  primary key (account_id, sequence, channel)
);

create index if not exists sync_notifications_account_created_idx
  on public.sync_notifications (account_id, created_at);

alter table public.sync_account_counters enable row level security;
alter table public.sync_events enable row level security;
alter table public.sync_notifications enable row level security;

drop policy if exists "sync counters account read" on public.sync_account_counters;
create policy "sync counters account read"
  on public.sync_account_counters for select to authenticated
  using (account_id = (select private.current_account_id()));

drop policy if exists "sync events account read" on public.sync_events;
create policy "sync events account read"
  on public.sync_events for select to authenticated
  using (account_id = (select private.current_account_id()));

drop policy if exists "sync notifications account read" on public.sync_notifications;
create policy "sync notifications account read"
  on public.sync_notifications for select to authenticated
  using (account_id = (select private.current_account_id()));

revoke all on public.sync_account_counters from anon, authenticated;
revoke all on public.sync_events from anon, authenticated;
revoke all on public.sync_notifications from anon, authenticated;

grant select on public.sync_account_counters to authenticated;
grant select on public.sync_events to authenticated;
grant select on public.sync_notifications to authenticated;

comment on table public.sync_account_counters is
  'Per-account monotonic sequence allocator; writes are reserved for trusted database functions.';
comment on table public.sync_events is
  'Append-only incremental event payloads. Do not add this table to Supabase Realtime publication.';
comment on table public.sync_notifications is
  'Minimal Realtime wake-up rows only; never include business payloads in this table.';

-- Deliberately deferred:
-- 1. account derivation and trusted event-append function;
-- 2. trigger on app_state after deployed RPC and auth mapping review;
-- 3. publication membership for sync_notifications only;
-- 4. retention and baseline snapshot recovery policy.
