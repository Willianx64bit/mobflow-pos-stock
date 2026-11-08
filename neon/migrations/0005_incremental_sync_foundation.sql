-- MobFlow PDV — additive incremental-sync foundation (NOT YET APPLIED)
-- Target: Neon test branch only after API integration and authorization review.
-- Does not alter app_state, existing stock logic, auth, or Realtime configuration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mobflow_sync_counters (
  tenant_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mobflow_sync_events (
  event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  idempotency_key uuid NOT NULL,
  actor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN (
    'stock', 'price', 'catalog', 'receiving', 'conference',
    'promotions', 'users', 'settings', 'master_data', 'sales', 'cash'
  )),
  delivery_mode text NOT NULL CHECK (delivery_mode IN ('automatic', 'manual')),
  entity_type text NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 80),
  entity_id text NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 160),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 131072),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mobflow_sync_events_tenant_sequence_key UNIQUE (tenant_id, sequence),
  CONSTRAINT mobflow_sync_events_tenant_idempotency_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT mobflow_sync_events_tenant_event_key UNIQUE (tenant_id, event_id)
);

CREATE INDEX IF NOT EXISTS mobflow_sync_events_tenant_created_idx
  ON public.mobflow_sync_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mobflow_sync_events_tenant_category_sequence_idx
  ON public.mobflow_sync_events (tenant_id, category, sequence);

ALTER TABLE public.mobflow_sync_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobflow_sync_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mobflow_sync_counters_tenant_access ON public.mobflow_sync_counters;
CREATE POLICY mobflow_sync_counters_tenant_access
  ON public.mobflow_sync_counters
  FOR ALL TO mobflow_api
  USING (
    tenant_id = NULLIF(current_setting('app.account_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.account_id', true), '')::uuid
  );

DROP POLICY IF EXISTS mobflow_sync_events_tenant_select ON public.mobflow_sync_events;
CREATE POLICY mobflow_sync_events_tenant_select
  ON public.mobflow_sync_events
  FOR SELECT TO mobflow_api
  USING (
    tenant_id = NULLIF(current_setting('app.account_id', true), '')::uuid
  );

DROP POLICY IF EXISTS mobflow_sync_events_tenant_insert ON public.mobflow_sync_events;
CREATE POLICY mobflow_sync_events_tenant_insert
  ON public.mobflow_sync_events
  FOR INSERT TO mobflow_api
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.account_id', true), '')::uuid
    AND actor_profile_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (
      SELECT 1
      FROM public.profiles actor
      WHERE actor.id = actor_profile_id
        AND actor.account_id = tenant_id
        AND actor.active = true
    )
  );

GRANT SELECT, INSERT ON public.mobflow_sync_events TO mobflow_api;
GRANT SELECT, INSERT, UPDATE ON public.mobflow_sync_counters TO mobflow_api;

-- Append one event in the caller's existing transaction.
-- The per-tenant counter row lock serializes sequence allocation and
-- idempotency checks, so retrying the same key returns the original sequence.
CREATE OR REPLACE FUNCTION public.mobflow_append_sync_event(
  p_event_id uuid,
  p_idempotency_key uuid,
  p_category text,
  p_delivery_mode text,
  p_entity_type text,
  p_entity_id text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_actor_id uuid;
  v_sequence bigint;
BEGIN
  v_tenant_id := NULLIF(current_setting('app.account_id', true), '')::uuid;
  v_actor_id := NULLIF(current_setting('app.user_id', true), '')::uuid;

  IF v_tenant_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MobFlow tenant/user context is required' USING ERRCODE = '42501';
  END IF;

  IF p_event_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Event and idempotency identifiers are required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.mobflow_sync_counters (tenant_id, last_sequence)
  VALUES (v_tenant_id, 0)
  ON CONFLICT (tenant_id) DO NOTHING;

  PERFORM 1
  FROM public.mobflow_sync_counters
  WHERE tenant_id = v_tenant_id
  FOR UPDATE;

  SELECT sequence INTO v_sequence
  FROM public.mobflow_sync_events
  WHERE tenant_id = v_tenant_id
    AND idempotency_key = p_idempotency_key;

  IF v_sequence IS NOT NULL THEN
    RETURN v_sequence;
  END IF;

  UPDATE public.mobflow_sync_counters
  SET last_sequence = last_sequence + 1,
      updated_at = clock_timestamp()
  WHERE tenant_id = v_tenant_id
  RETURNING last_sequence INTO v_sequence;

  INSERT INTO public.mobflow_sync_events (
    event_id, tenant_id, sequence, idempotency_key, actor_profile_id,
    category, delivery_mode, entity_type, entity_id, payload
  ) VALUES (
    p_event_id, v_tenant_id, v_sequence, p_idempotency_key, v_actor_id,
    p_category, p_delivery_mode, p_entity_type, p_entity_id,
    COALESCE(p_payload, '{}'::jsonb)
  );

  RETURN v_sequence;
END;
$$;

REVOKE ALL ON FUNCTION public.mobflow_append_sync_event(
  uuid, uuid, text, text, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mobflow_append_sync_event(
  uuid, uuid, text, text, text, text, jsonb
) TO mobflow_api;

COMMIT;
