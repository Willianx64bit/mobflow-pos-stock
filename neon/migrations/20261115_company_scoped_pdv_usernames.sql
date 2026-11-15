BEGIN;

-- A identidade visível do usuário é única dentro da empresa, não no MobFlow inteiro.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_username_key;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_username_key UNIQUE (account_id, username);

-- A allowlist também precisa aceitar o mesmo username em CNPJs diferentes.
ALTER TABLE public.account_allowlist
  DROP CONSTRAINT IF EXISTS account_allowlist_pkey;

ALTER TABLE public.account_allowlist
  ADD CONSTRAINT account_allowlist_username_cnpj_key PRIMARY KEY (username, cnpj);

CREATE OR REPLACE FUNCTION public.mobflow_create_pdv_user(
  p_manager_id uuid,
  p_account_id uuid,
  p_user_id uuid,
  p_username text,
  p_display_name text,
  p_permissions jsonb,
  p_password_hash text,
  p_email text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  manager_cnpj text;
  allowed_active boolean;
  effective_permissions jsonb := COALESCE(p_permissions, '[]'::jsonb);
  created_at_value timestamp without time zone := now()::timestamp;
BEGIN
  SELECT cnpj INTO manager_cnpj
  FROM public.profiles
  WHERE id = p_manager_id
    AND account_id = p_account_id
    AND active = true
    AND (role = 'manager' OR permissions @> '["Gerência"]'::jsonb)
  LIMIT 1;

  IF manager_cnpj IS NULL THEN
    RAISE EXCEPTION 'Manager authorization is invalid' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_username IS NULL OR p_password_hash IS NULL OR p_email IS NULL THEN
    RAISE EXCEPTION 'Missing PDV user data' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE account_id = p_account_id AND username = p_username
  ) THEN
    RAISE EXCEPTION 'PDV username already exists in this company' USING ERRCODE = '23505';
  END IF;

  SELECT active INTO allowed_active
  FROM public.account_allowlist
  WHERE username = p_username AND cnpj = manager_cnpj
  LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE account_id = p_account_id AND role = 'pdv'
  ) AND NOT (effective_permissions @> '["Gerência"]'::jsonb) THEN
    effective_permissions := effective_permissions || '["Gerência"]'::jsonb;
  END IF;

  IF allowed_active IS NULL THEN
    INSERT INTO public.account_allowlist (username, cnpj, active)
    VALUES (p_username, manager_cnpj, true);
  ELSIF NOT allowed_active THEN
    UPDATE public.account_allowlist
    SET active = true
    WHERE username = p_username AND cnpj = manager_cnpj;
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

CREATE OR REPLACE FUNCTION public.mobflow_find_login_profile(
  p_username text,
  p_cnpj text
)
RETURNS TABLE(
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
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT p.id, p.username, p.cnpj, p.account_id, p.role,
         p.active, p.display_name, p.permissions
  FROM public.profiles AS p
  WHERE p.username = p_username
    AND p.cnpj = p_cnpj
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.mobflow_find_login_profile(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mobflow_find_login_profile(text, text) TO mobflow_api;

COMMIT;
