-- Preserve historical operational references when a legacy PDV user is removed.
-- Deactivate the login and revoke Better Auth credentials/sessions, but retain
-- the profile row as an audit identity for sales, cash, stock and sync history.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE OR REPLACE FUNCTION public.mobflow_delete_pdv_user(
  p_manager_id uuid,
  p_account_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  manager_cnpj text;
  target_username text;
BEGIN
  SELECT manager.cnpj INTO manager_cnpj
  FROM public.profiles manager
  WHERE manager.id = p_manager_id
    AND manager.account_id = p_account_id
    AND manager.active = true
    AND manager.deleted_at IS NULL
    AND (manager.role = 'manager' OR manager.permissions @> '["Gerência"]'::jsonb)
  LIMIT 1;
  IF manager_cnpj IS NULL THEN
    RAISE EXCEPTION 'Manager authorization is invalid' USING ERRCODE = '42501';
  END IF;

  SELECT target.username INTO target_username
  FROM public.profiles target
  WHERE target.id = p_user_id
    AND target.account_id = p_account_id
    AND target.role = 'pdv'
    AND target.deleted_at IS NULL
  LIMIT 1;
  IF target_username IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.account_allowlist
  SET active = false
  WHERE username = target_username AND cnpj = manager_cnpj;

  DELETE FROM public."session" WHERE "userId" = p_user_id::text;
  DELETE FROM public."account" WHERE "userId" = p_user_id::text;
  UPDATE public.profiles
  SET active = false, deleted_at = COALESCE(deleted_at, now())
  WHERE id = p_user_id AND account_id = p_account_id AND role = 'pdv';

  RETURN true;
END;
$function$;

ALTER FUNCTION public.mobflow_delete_pdv_user(uuid, uuid, uuid) OWNER TO mobflow_pdv_test_owner;
REVOKE ALL ON FUNCTION public.mobflow_delete_pdv_user(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mobflow_delete_pdv_user(uuid, uuid, uuid) TO mobflow_api;

CREATE OR REPLACE FUNCTION public.mobflow_list_pdv_users(
  p_manager_id uuid,
  p_account_id uuid
)
RETURNS TABLE (
  id uuid, username text, display_name text, role text, active boolean,
  created_at timestamptz, permissions jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles manager
    WHERE manager.id = p_manager_id
      AND manager.account_id = p_account_id
      AND manager.active = true
      AND manager.deleted_at IS NULL
      AND (manager.role = 'manager' OR manager.permissions @> '["Gerência"]'::jsonb)
  ) THEN
    RAISE EXCEPTION 'Manager authorization is invalid' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT profile.id, profile.username, profile.display_name,
         profile.role, profile.active, profile.created_at, profile.permissions
  FROM public.profiles profile
  WHERE profile.account_id = p_account_id
    AND profile.role = 'pdv'
    AND profile.deleted_at IS NULL
  ORDER BY profile.created_at DESC;
END;
$function$;

ALTER FUNCTION public.mobflow_list_pdv_users(uuid, uuid) OWNER TO mobflow_pdv_test_owner;
REVOKE ALL ON FUNCTION public.mobflow_list_pdv_users(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mobflow_list_pdv_users(uuid, uuid) TO mobflow_api;
