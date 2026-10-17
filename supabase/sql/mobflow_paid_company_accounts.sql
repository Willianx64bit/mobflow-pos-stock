-- MobFlow single paid plan: R$ 79.90/month.
-- New registrations remain pending until payment is confirmed and access is activated.
create table if not exists public.companies (
  account_id uuid primary key references auth.users(id) on delete cascade,
  company_name text not null check (length(trim(company_name)) between 2 and 120),
  cnpj text not null unique check (cnpj ~ '^[0-9]{14}$'),
  username text not null unique,
  email text not null,
  phone text not null,
  plan_code text not null default 'complete' check (plan_code = 'complete'),
  monthly_price numeric(10,2) not null default 79.90 check (monthly_price = 79.90),
  payment_method text not null default 'pix' check (payment_method = 'pix'),
  subscription_status text not null default 'pending_payment'
    check (subscription_status in ('pending_payment','active','past_due','suspended','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists companies_email_lower_uidx
  on public.companies (lower(email));
create index if not exists companies_subscription_status_idx
  on public.companies (subscription_status);

alter table public.companies enable row level security;
revoke all on table public.companies from anon, authenticated;
grant all on table public.companies to service_role;
