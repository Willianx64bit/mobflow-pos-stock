-- Delete one PDV identity atomically through a tenant-scoped manager check.
-- The application role has no direct DELETE grants on profiles or Better Auth tables.
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
    AND (
      manager.role = 'manager'
      OR manager.permissions @> '["Gerência"]'::jsonb
    )
  LIMIT 1;

  IF manager_cnpj IS NULL THEN
    RAISE EXCEPTION 'Manager authorization is invalid' USING ERRCODE = '42501';
  END IF;

  SELECT target.username INTO target_username
  FROM public.profiles target
  WHERE target.id = p_user_id
    AND target.account_id = p_account_id
    AND target.role = 'pdv'
  LIMIT 1;

  IF target_username IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.account_allowlist
  SET active = false
  WHERE username = target_username
    AND cnpj = manager_cnpj;

  DELETE FROM public.profiles
  WHERE id = p_user_id
    AND account_id = p_account_id
    AND role = 'pdv';

  DELETE FROM public."user"
  WHERE id = p_user_id::text;

  RETURN true;
END;
$function$;

ALTER FUNCTION public.mobflow_delete_pdv_user(uuid, uuid, uuid) OWNER TO mobflow_pdv_test_owner;
REVOKE ALL ON FUNCTION public.mobflow_delete_pdv_user(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mobflow_delete_pdv_user(uuid, uuid, uuid) TO mobflow_api;
