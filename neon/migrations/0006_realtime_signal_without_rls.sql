-- MobFlow PDV — Neon Realtime notification signal without RLS.
-- The existing event ledger and counter remain protected by tenant RLS.
-- This table contains only a tenant identifier and its latest committed sequence.
-- It is queried only through a backend-issued sealed query whose tenant parameter
-- comes from the authenticated server-side identity.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mobflow_realtime_signals (
  tenant_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0)
);

-- Neon Realtime does not currently support row-level security on subscribed queries.
-- Keep this deliberately tiny table free of RLS; never expose it through a browser DB
-- connection or an unsealed query.
ALTER TABLE public.mobflow_realtime_signals DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobflow_realtime_signals NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mobflow_realtime_signals FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mobflow_realtime_signals TO mobflow_api;

-- Preserve the current high-water mark for tenants that already have sync counters.
INSERT INTO public.mobflow_realtime_signals (tenant_id, last_sequence)
SELECT tenant_id, last_sequence
FROM public.mobflow_sync_counters
ON CONFLICT (tenant_id) DO UPDATE
SET last_sequence = GREATEST(
  public.mobflow_realtime_signals.last_sequence,
  EXCLUDED.last_sequence
);

-- Keep the signal in the same transaction as the durable event.
-- Idempotent retries also repair/advance the signal without creating another event.
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
    INSERT INTO public.mobflow_realtime_signals (tenant_id, last_sequence)
    VALUES (v_tenant_id, v_sequence)
    ON CONFLICT (tenant_id) DO UPDATE
    SET last_sequence = GREATEST(
      public.mobflow_realtime_signals.last_sequence,
      EXCLUDED.last_sequence
    );
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

  INSERT INTO public.mobflow_realtime_signals (tenant_id, last_sequence)
  VALUES (v_tenant_id, v_sequence)
  ON CONFLICT (tenant_id) DO UPDATE
  SET last_sequence = GREATEST(
    public.mobflow_realtime_signals.last_sequence,
    EXCLUDED.last_sequence
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
