-- 202611110001_promotion_device_sync.sql
-- Additive foundation for per-device promotion synchronization.
-- Reuses public.promotions (with its existing version column) and
-- public.mobflow_sync_events (category='promotions'); does not duplicate either ledger.

CREATE TABLE IF NOT EXISTS public.promotion_sync_devices (
  tenant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id text NOT NULL CHECK (length(device_id) BETWEEN 1 AND 160),
  last_event_sequence bigint NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, device_id)
);

CREATE INDEX IF NOT EXISTS promotion_sync_devices_tenant_updated_idx
  ON public.promotion_sync_devices (tenant_id, updated_at DESC);

ALTER TABLE public.promotion_sync_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_sync_devices FORCE ROW LEVEL SECURITY;

-- Keep this migration safely re-runnable if the policy was created manually
-- during preview validation or by a previous partial application.
DROP POLICY IF EXISTS promotion_sync_devices_tenant_access
  ON public.promotion_sync_devices;

CREATE POLICY promotion_sync_devices_tenant_access
  ON public.promotion_sync_devices
  FOR ALL TO mobflow_api
  USING (tenant_id = NULLIF(current_setting('app.account_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.account_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON public.promotion_sync_devices TO mobflow_api;
