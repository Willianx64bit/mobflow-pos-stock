-- Allow the authenticated Gerência identity to list PDV accounts without
-- weakening the general profiles RLS policy. The first Gerência operator can
-- be a role='pdv' profile with the explicit Gerência permission.
CREATE OR REPLACE FUNCTION public.mobflow_list_pdv_users(
  p_manager_id uuid,
  p_account_id uuid
)
RETURNS TABLE (
  id uuid,
  username text,
  display_name text,
  role text,
  active boolean,
  created_at timestamptz,
  permissions jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles manager
    WHERE manager.id = p_manager_id
      AND manager.account_id = p_account_id
      AND manager.active = true
      AND (
        manager.role = 'manager'
        OR manager.permissions @> '["Gerência"]'::jsonb
      )
  ) THEN
    RAISE EXCEPTION 'Manager authorization is invalid' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT profile.id, profile.username, profile.display_name,
         profile.role, profile.active, profile.created_at, profile.permissions
  FROM public.profiles profile
  WHERE profile.account_id = p_account_id
    AND profile.role = 'pdv'
  ORDER BY profile.created_at DESC;
END;
$function$;

ALTER FUNCTION public.mobflow_list_pdv_users(uuid, uuid) OWNER TO mobflow_pdv_test_owner;
REVOKE ALL ON FUNCTION public.mobflow_list_pdv_users(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mobflow_list_pdv_users(uuid, uuid) TO mobflow_api;
