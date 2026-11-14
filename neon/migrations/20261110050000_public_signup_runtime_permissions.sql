-- Public company signup permissions for the MobFlow PDV Preview.
-- Applies only to the migration/neon-preparation Preview database.
-- The runtime role is server-only; public requests still pass through the
-- validated /api/mobflow/signup handler.

BEGIN;

GRANT USAGE ON SCHEMA public TO mobflow_admin_auth_preview;
GRANT SELECT, INSERT, UPDATE, REFERENCES ON TABLE public.profiles TO mobflow_admin_auth_preview;
GRANT SELECT, INSERT, UPDATE ON TABLE public.companies TO mobflow_admin_auth_preview;
GRANT SELECT, INSERT ON TABLE public.account_allowlist TO mobflow_admin_auth_preview;
GRANT SELECT, INSERT, UPDATE ON TABLE public.app_state TO mobflow_admin_auth_preview;
GRANT SELECT ON TABLE public.admin_billing_settings TO mobflow_admin_auth_preview;

DROP POLICY IF EXISTS mobflow_signup_profiles_select ON public.profiles;
CREATE POLICY mobflow_signup_profiles_select
  ON public.profiles FOR SELECT TO mobflow_admin_auth_preview USING (true);
DROP POLICY IF EXISTS mobflow_signup_profiles_insert ON public.profiles;
CREATE POLICY mobflow_signup_profiles_insert
  ON public.profiles FOR INSERT TO mobflow_admin_auth_preview WITH CHECK (true);
DROP POLICY IF EXISTS mobflow_signup_profiles_update ON public.profiles;
CREATE POLICY mobflow_signup_profiles_update
  ON public.profiles FOR UPDATE TO mobflow_admin_auth_preview USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS mobflow_signup_companies_select ON public.companies;
CREATE POLICY mobflow_signup_companies_select
  ON public.companies FOR SELECT TO mobflow_admin_auth_preview USING (true);
DROP POLICY IF EXISTS mobflow_signup_companies_insert ON public.companies;
CREATE POLICY mobflow_signup_companies_insert
  ON public.companies FOR INSERT TO mobflow_admin_auth_preview WITH CHECK (true);
DROP POLICY IF EXISTS mobflow_signup_companies_update ON public.companies;
CREATE POLICY mobflow_signup_companies_update
  ON public.companies FOR UPDATE TO mobflow_admin_auth_preview USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS mobflow_signup_allowlist_select ON public.account_allowlist;
CREATE POLICY mobflow_signup_allowlist_select
  ON public.account_allowlist FOR SELECT TO mobflow_admin_auth_preview USING (true);
DROP POLICY IF EXISTS mobflow_signup_allowlist_insert ON public.account_allowlist;
CREATE POLICY mobflow_signup_allowlist_insert
  ON public.account_allowlist FOR INSERT TO mobflow_admin_auth_preview WITH CHECK (true);

DROP POLICY IF EXISTS mobflow_signup_state_insert ON public.app_state;
CREATE POLICY mobflow_signup_state_insert
  ON public.app_state FOR INSERT TO mobflow_admin_auth_preview
  WITH CHECK (
    owner_id = NULLIF(current_setting('app.account_id', true), '')::uuid
  );

COMMIT;
