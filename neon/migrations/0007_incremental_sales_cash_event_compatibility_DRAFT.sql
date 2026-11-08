-- MobFlow PDV — migration 0007: incremental sales/cash event compatibility
-- Additive compatibility migration for Neon branches where 0005 was already applied.
-- DRAFT: do not apply until the isolated test branch migration window is approved.

BEGIN;

ALTER TABLE public.mobflow_sync_events
  DROP CONSTRAINT IF EXISTS mobflow_sync_events_category_check;

ALTER TABLE public.mobflow_sync_events
  ADD CONSTRAINT mobflow_sync_events_category_check
  CHECK (category IN (
    'stock', 'price', 'catalog', 'receiving', 'conference',
    'promotions', 'users', 'settings', 'master_data', 'sales', 'cash'
  ));

ALTER TABLE public.mobflow_sync_events
  DROP CONSTRAINT IF EXISTS mobflow_sync_events_payload_check;

ALTER TABLE public.mobflow_sync_events
  ADD CONSTRAINT mobflow_sync_events_payload_check
  CHECK (
    jsonb_typeof(payload) = 'object'
    AND octet_length(payload::text) <= 131072
  );

COMMIT;
