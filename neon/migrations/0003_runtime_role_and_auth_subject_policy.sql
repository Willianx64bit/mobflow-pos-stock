-- MobFlow PDV / Neon migration 0003
-- Create a non-owner application role and allow a verified Neon subject to
-- resolve only its own identity link.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mobflow_api') THEN
    CREATE ROLE mobflow_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT mobflow_api TO CURRENT_USER;

CREATE POLICY auth_identity_links_subject_lookup
  ON public.auth_identity_links
  FOR SELECT
  USING (
    provider = 'neon'
    AND auth_user_id = NULLIF(current_setting('app.auth_user_id', true), '')
  );

GRANT SELECT ON public.auth_identity_links TO mobflow_api;
GRANT SELECT ON public.profiles TO mobflow_api;
GRANT SELECT, INSERT, UPDATE ON public.app_state TO mobflow_api;

COMMIT;
