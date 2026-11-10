-- MobFlow PDV Preview only: runtime grants required by Better Auth and
-- the server-side username/CNPJ login bridge.
-- Apply only to the migration Preview database, never Production.
BEGIN;

GRANT USAGE ON SCHEMA public TO mobflow_api_test;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO mobflow_api_test;
GRANT SELECT, INSERT, UPDATE ON TABLE public.companies TO mobflow_api_test;
GRANT SELECT ON TABLE
  public.account_allowlist,
  public.manager_security_by_account,
  public.admin_billing_settings
TO mobflow_api_test;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."user",
  public.session,
  public.account,
  public.verification,
  public.manager_password_recovery_tokens
TO mobflow_api_test;

DROP POLICY IF EXISTS mobflow_api_test_profiles_auth ON public.profiles;
CREATE POLICY mobflow_api_test_profiles_auth
  ON public.profiles FOR ALL TO mobflow_api_test
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS mobflow_api_test_companies_auth ON public.companies;
CREATE POLICY mobflow_api_test_companies_auth
  ON public.companies FOR ALL TO mobflow_api_test
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS mobflow_api_test_allowlist_auth ON public.account_allowlist;
CREATE POLICY mobflow_api_test_allowlist_auth
  ON public.account_allowlist FOR SELECT TO mobflow_api_test
  USING (true);

DROP POLICY IF EXISTS mobflow_api_test_manager_security_auth ON public.manager_security_by_account;
CREATE POLICY mobflow_api_test_manager_security_auth
  ON public.manager_security_by_account FOR ALL TO mobflow_api_test
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS mobflow_api_test_recovery_tokens_auth ON public.manager_password_recovery_tokens;
CREATE POLICY mobflow_api_test_recovery_tokens_auth
  ON public.manager_password_recovery_tokens FOR ALL TO mobflow_api_test
  USING (true) WITH CHECK (true);

COMMIT;