-- Keep login profile discovery narrow and establish the authenticated tenant context
-- before querying tables protected by tenant RLS.
CREATE OR REPLACE FUNCTION public.mobflow_find_login_profile(p_username text)
RETURNS TABLE (
  id uuid,
  username text,
  cnpj text,
  account_id uuid,
  role text,
  active boolean,
  display_name text,
  permissions jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT p.id, p.username, p.cnpj, p.account_id, p.role, p.active, p.display_name, p.permissions
  FROM public.profiles AS p
  WHERE p.username = p_username
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.mobflow_find_login_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mobflow_find_login_profile(text) TO mobflow_api;
