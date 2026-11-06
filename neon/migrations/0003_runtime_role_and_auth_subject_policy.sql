-- MobFlow PDV / Neon migration 0003
-- Restrict application API queries to the non-owner runtime role and allow
-- only the verified Neon Auth subject to resolve its own profile mapping.

BEGIN;

CREATE POLICY auth_identity_links_subject_lookup
  ON public.auth_identity_links
  FOR SELECT
  USING (
    provider = 'neon'
    AND auth_user_id = NULLIF(current_setting('app.auth_user_id', true), '')
  );

GRANT SELECT ON public.auth_identity_links TO mobflow_api_test;
GRANT SELECT ON public.profiles TO mobflow_api_test;
GRANT SELECT, INSERT, UPDATE ON public.app_state TO mobflow_api_test;
GRANT mobflow_api_test TO mobflow_pdv_test_owner;

COMMIT;
