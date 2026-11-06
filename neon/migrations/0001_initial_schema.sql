-- MobFlow PDV / Neon migration 0001
-- Test-only baseline derived from the live Supabase catalog.
-- Supabase Auth remains external. Stable Auth UUIDs are represented by profiles.id.
-- This migration deliberately does not import production data, password hashes, or tokens.

BEGIN;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  username text NOT NULL,
  cnpj text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  account_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'manager',
  active boolean NOT NULL DEFAULT true,
  display_name text,
  permissions jsonb NOT NULL DEFAULT '["PDV", "Conferência"]'::jsonb,
  CONSTRAINT profiles_username_key UNIQUE (username),
  CONSTRAINT profiles_role_check CHECK (role = ANY (ARRAY['manager'::text, 'pdv'::text, 'admin'::text])),
  CONSTRAINT profiles_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE INDEX profiles_account_id_idx ON public.profiles USING btree (account_id);

CREATE TABLE public.app_state (
  owner_id uuid PRIMARY KEY,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_state_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.account_allowlist (
  username text PRIMARY KEY,
  cnpj text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.manager_security (
  id boolean PRIMARY KEY DEFAULT true,
  password_hash text NOT NULL,
  CONSTRAINT manager_security_single_row CHECK (id = true)
);

CREATE TABLE public.manager_security_by_account (
  account_id uuid PRIMARY KEY,
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.companies (
  account_id uuid PRIMARY KEY,
  company_name text NOT NULL,
  cnpj text NOT NULL,
  username text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  plan_code text NOT NULL DEFAULT 'complete',
  monthly_price numeric(10,2) NOT NULL DEFAULT 69.90,
  subscription_status text NOT NULL DEFAULT 'pending_payment',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  payment_method text NOT NULL DEFAULT 'pix',
  payment_confirmed_at timestamptz,
  payment_confirmed_by uuid,
  payment_notes text,
  payment_request_token uuid NOT NULL DEFAULT gen_random_uuid(),
  payment_proof_path text,
  payment_submitted_at timestamptz,
  manager_setup_token uuid,
  manager_setup_completed_at timestamptz,
  subscription_expires_at timestamptz,
  CONSTRAINT companies_company_name_check CHECK (length(trim(company_name)) >= 2 AND length(trim(company_name)) <= 120),
  CONSTRAINT companies_cnpj_check CHECK (cnpj ~ '^[0-9]{14}$'),
  CONSTRAINT companies_cnpj_key UNIQUE (cnpj),
  CONSTRAINT companies_username_key UNIQUE (username),
  CONSTRAINT companies_plan_code_check CHECK (plan_code = 'complete'),
  CONSTRAINT companies_monthly_price_check CHECK (monthly_price > 0 AND monthly_price <= 9999.99),
  CONSTRAINT companies_subscription_status_check CHECK (subscription_status = ANY (ARRAY['pending_payment'::text, 'active'::text, 'past_due'::text, 'suspended'::text, 'cancelled'::text])),
  CONSTRAINT companies_payment_method_check CHECK (payment_method = 'pix'),
  CONSTRAINT companies_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT companies_payment_confirmed_by_fkey FOREIGN KEY (payment_confirmed_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
);

CREATE UNIQUE INDEX companies_payment_request_token_uidx ON public.companies USING btree (payment_request_token);
CREATE UNIQUE INDEX companies_email_lower_uidx ON public.companies USING btree (lower(email));
CREATE UNIQUE INDEX companies_manager_setup_token_uidx ON public.companies USING btree (manager_setup_token) WHERE manager_setup_token IS NOT NULL;
CREATE INDEX companies_subscription_status_idx ON public.companies USING btree (subscription_status);
CREATE INDEX companies_subscription_expires_at_idx ON public.companies USING btree (subscription_expires_at) WHERE subscription_expires_at IS NOT NULL;

CREATE TABLE public.manager_password_recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manager_password_recovery_tokens_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT manager_password_recovery_tokens_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX manager_password_recovery_tokens_account_created_idx
  ON public.manager_password_recovery_tokens USING btree (account_id, created_at DESC);

-- Preserve the production RLS-enabled posture. The first test API slice uses
-- transaction-local identity context set only after server-side Supabase Auth verification.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_security_by_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_password_recovery_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles account select" ON public.profiles
  FOR SELECT
  USING (
    id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR (
      current_setting('app.role', true) = 'manager'
      AND account_id = NULLIF(current_setting('app.account_id', true), '')::uuid
    )
  );

CREATE POLICY "state account select" ON public.app_state
  FOR SELECT
  USING (owner_id = NULLIF(current_setting('app.account_id', true), '')::uuid);

CREATE POLICY "state account insert" ON public.app_state
  FOR INSERT
  WITH CHECK (owner_id = NULLIF(current_setting('app.account_id', true), '')::uuid);

CREATE POLICY "state account update" ON public.app_state
  FOR UPDATE
  USING (owner_id = NULLIF(current_setting('app.account_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.account_id', true), '')::uuid);

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

COMMIT;
