-- Persistent authentication abuse controls for the MobFlow PDV Preview.
-- Values stored in scope_hash are HMACs; raw usernames, IPs and device IDs are never persisted.
CREATE TABLE IF NOT EXISTS public.mobflow_auth_security_state (
  scope_type text NOT NULL CHECK (scope_type IN ('login','manager_password','ip','device','company')),
  scope_hash text NOT NULL CHECK (length(scope_hash) = 64),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_failure_at timestamptz,
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_type, scope_hash)
);

CREATE INDEX IF NOT EXISTS mobflow_auth_security_state_blocked_idx
  ON public.mobflow_auth_security_state (blocked_until)
  WHERE blocked_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.mobflow_auth_security_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('login_failed','login_succeeded','manager_password_failed','manager_password_succeeded','captcha_rejected')),
  scope_type text NOT NULL CHECK (scope_type IN ('login','manager_password','ip','device','company')),
  scope_hash text NOT NULL CHECK (length(scope_hash) = 64),
  account_id uuid,
  blocked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mobflow_auth_security_events_created_idx
  ON public.mobflow_auth_security_events (created_at DESC);

REVOKE ALL ON public.mobflow_auth_security_state FROM PUBLIC;
REVOKE ALL ON public.mobflow_auth_security_events FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.mobflow_auth_security_state TO mobflow_api;
GRANT INSERT ON public.mobflow_auth_security_events TO mobflow_api;
GRANT USAGE, SELECT ON SEQUENCE public.mobflow_auth_security_events_id_seq TO mobflow_api;
