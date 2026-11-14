-- Create PDV users through a narrowly scoped SECURITY DEFINER function.
-- The function validates the authenticated manager and tenant before writing credentials.
CREATE OR REPLACE FUNCTION public.mobflow_create_pdv_user(
  p_manager_id uuid, p_account_id uuid, p_user_id uuid, p_username text,
  p_display_name text, p_permissions jsonb, p_password_hash text, p_email text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  manager_cnpj text;
  allowed_company text;
  allowed_active boolean;
  effective_permissions jsonb := COALESCE(p_permissions, '[]'::jsonb);
  created_at_value timestamp without time zone := now()::timestamp;
BEGIN
  SELECT cnpj INTO manager_cnpj
  FROM public.profiles
  WHERE id = p_manager_id AND account_id = p_account_id AND active = true
    AND (role = 'manager' OR permissions @> '["Gerência"]'::jsonb)
  LIMIT 1;
  IF manager_cnpj IS NULL THEN
    RAISE EXCEPTION 'Manager authorization is invalid' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_username IS NULL OR p_password_hash IS NULL OR p_email IS NULL THEN
    RAISE EXCEPTION 'Missing PDV user data' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = p_username) THEN
    RAISE EXCEPTION 'PDV username already exists' USING ERRCODE = '23505';
  END IF;
  SELECT cnpj, active INTO allowed_company, allowed_active
  FROM public.account_allowlist WHERE username = p_username LIMIT 1;
  IF FOUND AND allowed_company <> manager_cnpj THEN
    RAISE EXCEPTION 'PDV username belongs to another company' USING ERRCODE = '23505';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE account_id = p_account_id AND role = 'pdv')
     AND NOT (effective_permissions @> '["Gerência"]'::jsonb) THEN
    effective_permissions := effective_permissions || '["Gerência"]'::jsonb;
  END IF;
  IF allowed_company IS NULL THEN
    INSERT INTO public.account_allowlist (username, cnpj, active) VALUES (p_username, manager_cnpj, true);
  ELSIF NOT allowed_active THEN
    UPDATE public.account_allowlist SET cnpj = manager_cnpj, active = true WHERE username = p_username;
  END IF;
  INSERT INTO public."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
  VALUES (p_user_id::text, p_display_name, p_email, true, created_at_value, created_at_value);
  INSERT INTO public."account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
  VALUES (p_user_id::text, p_user_id::text, 'credential', p_user_id::text, p_password_hash, created_at_value, created_at_value);
  INSERT INTO public.profiles (id, username, cnpj, account_id, role, active, display_name, permissions)
  VALUES (p_user_id, p_username, manager_cnpj, p_account_id, 'pdv', true, p_display_name, effective_permissions);
  RETURN true;
END;
$function$;

ALTER FUNCTION public.mobflow_create_pdv_user(uuid, uuid, uuid, text, text, jsonb, text, text) OWNER TO mobflow_pdv_test_owner;
REVOKE ALL ON FUNCTION public.mobflow_create_pdv_user(uuid, uuid, uuid, text, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mobflow_create_pdv_user(uuid, uuid, uuid, text, text, jsonb, text, text) TO mobflow_admin_data_preview;
