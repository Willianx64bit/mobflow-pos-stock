-- MobFlow PDV: RLS policies for isolated public signup and subscription enforcement.
-- Apply only to the Preview database mobflow_pdv_clean_start on branch
-- mobflow-historical-rehearsal-20261109. Never apply to production.

BEGIN;

GRANT SELECT ON public.companies TO mobflow_api;
CREATE POLICY mobflow_api_select_own_company
  ON public.companies
  FOR SELECT TO mobflow_api
  USING (account_id = NULLIF(current_setting('app.account_id', true), '')::uuid);

CREATE POLICY mobflow_signup_preview_select_companies
  ON public.companies
  FOR SELECT TO mobflow_signup_preview
  USING (true);

CREATE POLICY mobflow_signup_preview_insert_companies
  ON public.companies
  FOR INSERT TO mobflow_signup_preview
  WITH CHECK (
    account_id = NULLIF(current_setting('app.account_id', true), '')::uuid
    AND subscription_status = 'pending_payment'
  );

CREATE POLICY mobflow_signup_preview_update_companies
  ON public.companies
  FOR UPDATE TO mobflow_signup_preview
  USING (account_id = NULLIF(current_setting('app.account_id', true), '')::uuid)
  WITH CHECK (
    account_id = NULLIF(current_setting('app.account_id', true), '')::uuid
    AND subscription_status = 'pending_payment'
  );

CREATE POLICY mobflow_signup_preview_select_profiles
  ON public.profiles
  FOR SELECT TO mobflow_signup_preview
  USING (true);

CREATE POLICY mobflow_signup_preview_insert_profiles
  ON public.profiles
  FOR INSERT TO mobflow_signup_preview
  WITH CHECK (
    id = account_id
    AND account_id = NULLIF(current_setting('app.account_id', true), '')::uuid
    AND role = 'manager'
    AND active = true
  );

CREATE POLICY mobflow_signup_preview_update_profiles
  ON public.profiles
  FOR UPDATE TO mobflow_signup_preview
  USING (
    account_id = NULLIF(current_setting('app.account_id', true), '')::uuid
    AND role = 'manager'
  )
  WITH CHECK (
    account_id = NULLIF(current_setting('app.account_id', true), '')::uuid
    AND role = 'manager'
  );

CREATE POLICY mobflow_signup_preview_select_account_allowlist
  ON public.account_allowlist
  FOR SELECT TO mobflow_signup_preview
  USING (true);

CREATE POLICY mobflow_signup_preview_insert_account_allowlist
  ON public.account_allowlist
  FOR INSERT TO mobflow_signup_preview
  WITH CHECK (active = true);

COMMIT;
