-- Allow the authenticated MobFlow API role to call the narrowly scoped
-- SECURITY DEFINER helpers used by the Gerência password setup and verification.
-- The API authenticates the company user and sets app.account_id before use.
GRANT EXECUTE ON FUNCTION public.mobflow_get_manager_password_hash(uuid) TO mobflow_api;
GRANT EXECUTE ON FUNCTION public.mobflow_set_manager_password_hash(uuid, text) TO mobflow_api;
