-- MobFlow administrator access and manual payment confirmation metadata.
-- Admin allowlist entries are provisioned directly in the protected database and must not be committed here.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array['manager'::text, 'pdv'::text, 'admin'::text]));

create table if not exists public.mobflow_admin_allowlist (
  username text primary key,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.mobflow_admin_allowlist enable row level security;
revoke all on public.mobflow_admin_allowlist from anon, authenticated;
grant all on public.mobflow_admin_allowlist to service_role;

alter table public.companies
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists payment_notes text;
