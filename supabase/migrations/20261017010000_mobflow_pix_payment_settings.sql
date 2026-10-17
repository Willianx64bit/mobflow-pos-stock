create table if not exists public.mobflow_payment_settings (
  id boolean primary key default true check (id = true),
  pix_key text not null default '',
  recipient_name text not null default 'MOBFLOW',
  recipient_city text not null default 'CAPAO BONITO',
  monthly_price numeric(10,2) not null default 79.90 check (monthly_price >= 0),
  updated_at timestamptz not null default now()
);
alter table public.mobflow_payment_settings enable row level security;
revoke all on public.mobflow_payment_settings from anon, authenticated;
grant all on public.mobflow_payment_settings to service_role;
insert into public.mobflow_payment_settings (id, pix_key, recipient_name, recipient_city, monthly_price)
values (true, '', 'MOBFLOW', 'CAPAO BONITO', 79.90)
on conflict (id) do nothing;
