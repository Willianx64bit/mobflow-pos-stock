-- Restrict manager-password storage to narrowly scoped SECURITY DEFINER helpers.
-- The application must authenticate the manager before calling these functions.
CREATE OR REPLACE FUNCTION public.mobflow_get_manager_password_hash(p_account_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT password_hash
  FROM public.manager_security_by_account
  WHERE account_id = p_account_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.mobflow_set_manager_password_hash(
  p_account_id uuid,
  p_password_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_account_id IS NULL OR p_password_hash IS NULL OR length(p_password_hash) <> 64 THEN
    RAISE EXCEPTION 'Invalid manager password data';
  END IF;

  INSERT INTO public.manager_security_by_account (account_id, password_hash, updated_at)
  VALUES (p_account_id, p_password_hash, now())
  ON CONFLICT (account_id) DO NOTHING;

  RETURN FOUND;
END;
$$;

ALTER FUNCTION public.mobflow_get_manager_password_hash(uuid) OWNER TO mobflow_pdv_test_owner;
ALTER FUNCTION public.mobflow_set_manager_password_hash(uuid, text) OWNER TO mobflow_pdv_test_owner;

REVOKE ALL ON FUNCTION public.mobflow_get_manager_password_hash(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mobflow_set_manager_password_hash(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mobflow_get_manager_password_hash(uuid) TO mobflow_admin_data_preview;
GRANT EXECUTE ON FUNCTION public.mobflow_set_manager_password_hash(uuid, text) TO mobflow_admin_data_preview;
