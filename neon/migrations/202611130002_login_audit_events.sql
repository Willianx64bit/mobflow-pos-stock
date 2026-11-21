-- Detailed, append-only login audit events for the MobFlow security panel.
-- Raw identifiers are restricted to inserts by the application runtime role.
CREATE TABLE IF NOT EXISTS public.mobflow_login_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid,
  company_cnpj text CHECK (company_cnpj IS NULL OR company_cnpj ~ '^[0-9]{14}$'),
  attempted_username text NOT NULL CHECK (length(attempted_username) BETWEEN 1 AND 128),
  attempted_role text NOT NULL CHECK (attempted_role IN ('manager', 'pdv')),
  event_type text NOT NULL CHECK (event_type IN ('login_succeeded', 'login_failed', 'login_blocked', 'login_denied', 'captcha_rejected')),
  success boolean NOT NULL,
  http_status integer NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  ip_address text,
  device_id text,
  user_agent text,
  browser text,
  operating_system text,
  country text,
  region text,
  city text,
  neighborhood text,
  location_permission text NOT NULL DEFAULT 'not_requested'
    CHECK (location_permission IN ('granted', 'denied', 'unavailable', 'not_requested')),
  latitude numeric(9,6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  location_accuracy_m numeric(10,2) CHECK (location_accuracy_m IS NULL OR location_accuracy_m > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE INDEX IF NOT EXISTS mobflow_login_audit_created_idx
  ON public.mobflow_login_audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS mobflow_login_audit_company_created_idx
  ON public.mobflow_login_audit_events (company_cnpj, created_at DESC);
CREATE INDEX IF NOT EXISTS mobflow_login_audit_username_created_idx
  ON public.mobflow_login_audit_events (lower(attempted_username), created_at DESC);
CREATE INDEX IF NOT EXISTS mobflow_login_audit_ip_created_idx
  ON public.mobflow_login_audit_events (ip_address, created_at DESC)
  WHERE ip_address IS NOT NULL;

REVOKE ALL ON public.mobflow_login_audit_events FROM PUBLIC;
GRANT INSERT ON public.mobflow_login_audit_events TO mobflow_api;
GRANT USAGE, SELECT ON SEQUENCE public.mobflow_login_audit_events_id_seq TO mobflow_api;
