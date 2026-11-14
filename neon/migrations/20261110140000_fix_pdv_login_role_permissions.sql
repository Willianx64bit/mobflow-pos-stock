-- Allow the Preview data connection to assume the narrowly scoped application role.
-- Keep password hashes and manager-security reads behind SECURITY DEFINER helpers.
GRANT mobflow_api TO mobflow_admin_data_preview WITH INHERIT FALSE, SET TRUE;

CREATE OR REPLACE FUNCTION public.mobflow_get_login_credential(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT a.password
  FROM public."account" AS a
  WHERE a."userId" = p_user_id::text
    AND a."accountId" = p_user_id::text
    AND a."providerId" = 'credential'
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.mobflow_is_first_manager_login(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.manager_security_by_account AS s
    WHERE s.account_id = p_account_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS p
    WHERE p.account_id = p_account_id AND p.role = 'pdv' AND p.active = true
  )
$function$;

CREATE OR REPLACE FUNCTION public.mobflow_mark_subscription_past_due(p_account_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.companies
  SET subscription_status = 'past_due', updated_at = now()
  WHERE account_id = p_account_id
    AND subscription_status = 'active'
    AND subscription_expires_at IS NOT NULL
    AND subscription_expires_at <= now();
  RETURN FOUND;
END
$function$;

REVOKE ALL ON FUNCTION public.mobflow_get_login_credential(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mobflow_is_first_manager_login(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mobflow_mark_subscription_past_due(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mobflow_get_login_credential(uuid) TO mobflow_api;
GRANT EXECUTE ON FUNCTION public.mobflow_is_first_manager_login(uuid) TO mobflow_api;
GRANT EXECUTE ON FUNCTION public.mobflow_mark_subscription_past_due(uuid) TO mobflow_api;
