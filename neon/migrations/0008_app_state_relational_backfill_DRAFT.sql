-- MobFlow PDV — migration 0008: safe app_state relational backfill (DRAFT)
-- Apply only after 0006_operational_relational_foundation and 0007_event_compatibility
-- have been reviewed and tested on an isolated Neon branch.
-- This migration preserves app_state as the rollback/source snapshot; it never deletes it.
-- A tenant is migrated atomically and exactly once per source snapshot checksum.
-- Historical stock movements are labeled legacy_reconstructed because app_state alone
-- cannot prove that every historical row was an immutable, server-verified ledger event.

BEGIN;

CREATE TABLE IF NOT EXISTS public.promotions (
  tenant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  id text NOT NULL,
  product_id text,
  product_name_snapshot text NOT NULL DEFAULT '',
  original_price numeric(14,2) NOT NULL CHECK (original_price >= 0),
  promo_price numeric(14,2) NOT NULL CHECK (promo_price >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT promotions_product_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.products(tenant_id, id) ON DELETE SET NULL (product_id),
  CONSTRAINT promotions_date_range_check
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS promotions_tenant_product_idx
  ON public.promotions (tenant_id, product_id);
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS promotions_tenant_access ON public.promotions;
CREATE POLICY promotions_tenant_access ON public.promotions
  FOR ALL TO mobflow_api
  USING (tenant_id = NULLIF(current_setting('app.account_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.account_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promotions TO mobflow_api;
REVOKE ALL ON public.promotions FROM PUBLIC;

CREATE TABLE IF NOT EXISTS public.mobflow_legacy_backfill_runs (
  tenant_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  source_updated_at timestamptz NOT NULL,
  source_hash text NOT NULL CHECK (length(source_hash) = 32),
  products_count integer NOT NULL DEFAULT 0,
  sales_count integer NOT NULL DEFAULT 0,
  cash_sessions_count integer NOT NULL DEFAULT 0,
  cash_movements_count integer NOT NULL DEFAULT 0,
  stock_movements_count integer NOT NULL DEFAULT 0,
  promotions_count integer NOT NULL DEFAULT 0,
  receivable_payments_count integer NOT NULL DEFAULT 0,
  completed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.mobflow_legacy_backfill_runs FROM PUBLIC;

-- Legacy receipt metadata was not captured; preserve it as explicitly unknown.
ALTER TABLE public.receivable_payments
  ALTER COLUMN operator_profile_id DROP NOT NULL;
ALTER TABLE public.receivable_payments
  DROP CONSTRAINT IF EXISTS receivable_payments_payment_method_check;
ALTER TABLE public.receivable_payments
  ADD CONSTRAINT receivable_payments_payment_method_check
  CHECK (payment_method IN ('cash','pix','card','legacy_unknown'));

DO $backfill$
DECLARE
  src record;
  v_hash text;
  v_count_products integer;
  v_count_sales integer;
  v_count_cash_sessions integer;
  v_count_cash_movements integer;
  v_count_stock_movements integer;
  v_count_promotions integer;
  v_count_receivable_payments integer;
BEGIN
  -- Lock each snapshot row so a legacy full-state save cannot race the backfill.
  FOR src IN
    SELECT owner_id, state, updated_at
    FROM public.app_state
    ORDER BY owner_id
    FOR UPDATE
  LOOP
    v_hash := md5(src.state::text);

    IF EXISTS (
      SELECT 1 FROM public.mobflow_legacy_backfill_runs r
      WHERE r.tenant_id = src.owner_id AND r.source_hash = v_hash
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.mobflow_legacy_backfill_runs r
      WHERE r.tenant_id = src.owner_id
    ) THEN
      RAISE EXCEPTION 'Legacy snapshot changed after a prior backfill for tenant %; reconcile explicitly before retrying', src.owner_id;
    END IF;

    IF EXISTS (SELECT 1 FROM public.products WHERE tenant_id = src.owner_id)
       OR EXISTS (SELECT 1 FROM public.sales WHERE tenant_id = src.owner_id)
       OR EXISTS (SELECT 1 FROM public.cash_sessions WHERE tenant_id = src.owner_id)
       OR EXISTS (SELECT 1 FROM public.cash_movements WHERE tenant_id = src.owner_id)
       OR EXISTS (SELECT 1 FROM public.stock_movements WHERE tenant_id = src.owner_id)
       OR EXISTS (SELECT 1 FROM public.promotions WHERE tenant_id = src.owner_id) THEN
      RAISE EXCEPTION 'Relational rows already exist for tenant % without a backfill marker; refusing to merge automatically', src.owner_id;
    END IF;

    IF jsonb_typeof(src.state->'products') IS NOT NULL AND jsonb_typeof(src.state->'products') <> 'array'
       OR jsonb_typeof(src.state->'sales') IS NOT NULL AND jsonb_typeof(src.state->'sales') <> 'array'
       OR jsonb_typeof(src.state->'cashSessions') IS NOT NULL AND jsonb_typeof(src.state->'cashSessions') <> 'array'
       OR jsonb_typeof(src.state->'cashMovements') IS NOT NULL AND jsonb_typeof(src.state->'cashMovements') <> 'array'
       OR jsonb_typeof(src.state->'stockMovements') IS NOT NULL AND jsonb_typeof(src.state->'stockMovements') <> 'array'
       OR jsonb_typeof(src.state->'promotions') IS NOT NULL AND jsonb_typeof(src.state->'promotions') <> 'array' THEN
      RAISE EXCEPTION 'Unexpected legacy JSON shape for tenant %; expected arrays for operational collections', src.owner_id;
    END IF;

    -- The source is an old snapshot, so every referenced operator must be resolved
    -- to a profile inside the same tenant before inserting FK-constrained records.
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(src.state->'sales', '[]'::jsonb)) sale
      WHERE NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.account_id = src.owner_id
          AND (lower(p.username) = lower(COALESCE(sale->>'seller',''))
            OR lower(COALESCE(p.display_name,'')) = lower(COALESCE(sale->>'seller','')))
      )
    ) THEN
      RAISE EXCEPTION 'A legacy sale seller cannot be mapped to a profile for tenant %', src.owner_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(src.state->'cashSessions', '[]'::jsonb)) cash
      WHERE NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.account_id = src.owner_id
          AND (lower(p.username) = lower(COALESCE(cash->>'openedBy',''))
            OR lower(COALESCE(p.display_name,'')) = lower(COALESCE(cash->>'openedBy','')))
      )
    ) THEN
      RAISE EXCEPTION 'A legacy cash-session operator cannot be mapped to a profile for tenant %', src.owner_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(src.state->'cashSessions', '[]'::jsonb)) cash
      WHERE COALESCE(cash->>'status','open') = 'closed'
        AND (NULLIF(cash->>'closedAt','') IS NULL OR NULLIF(cash->>'countedCash','') IS NULL)
    ) THEN
      RAISE EXCEPTION 'A closed legacy cash session lacks closing timestamp/count; refusing to invent closing data for tenant %', src.owner_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(src.state->'cashMovements', '[]'::jsonb)) movement
      WHERE NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.account_id = src.owner_id
          AND (lower(p.username) = lower(COALESCE(movement->>'operator',''))
            OR lower(COALESCE(p.display_name,'')) = lower(COALESCE(movement->>'operator','')))
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.cash_sessions cs
        WHERE cs.tenant_id = src.owner_id AND cs.id = movement->>'sessionId'
      )
    ) THEN
      RAISE EXCEPTION 'A legacy cash movement has no same-tenant operator or cash session for tenant %', src.owner_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(src.state->'cashMovements', '[]'::jsonb)) movement
      WHERE lower(COALESCE(movement->>'type',movement->>'movementType','')) NOT IN
        ('addition','reforco','entrada','withdrawal','sangria','saida')
    ) THEN
      RAISE EXCEPTION 'Unknown legacy cash movement type for tenant %; map it explicitly before backfill', src.owner_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(src.state->'sales', '[]'::jsonb)) sale
      WHERE lower(COALESCE(sale->>'payment','')) NOT LIKE '%dinheiro%'
        AND lower(COALESCE(sale->>'payment','')) NOT LIKE '%cash%'
        AND lower(COALESCE(sale->>'payment','')) NOT LIKE '%pix%'
        AND lower(COALESCE(sale->>'payment','')) NOT LIKE '%cart%'
        AND lower(COALESCE(sale->>'payment','')) NOT LIKE '%card%'
        AND lower(COALESCE(sale->>'payment','')) NOT LIKE '%fiado%'
        AND lower(COALESCE(sale->>'payment','')) NOT LIKE '%credi%'
    ) THEN
      RAISE EXCEPTION 'Unknown legacy payment method for tenant %; map it explicitly before backfill', src.owner_id;
    END IF;

    -- Fiado receipts are stored as an array on each legacy sale. Validate the
    -- complete list before inserting anything; never silently drop or truncate
    -- a receipt whose amount/date cannot be represented.
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(src.state->'sales', '[]'::jsonb)) sale
      WHERE lower(COALESCE(sale->>'payment','')) LIKE '%fiado%'
        AND sale ? 'payments'
        AND jsonb_typeof(sale->'payments') IS DISTINCT FROM 'array'
    ) THEN
      RAISE EXCEPTION 'A legacy Fiado payments field is not an array for tenant %', src.owner_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(src.state->'sales', '[]'::jsonb)) sale
      WHERE lower(COALESCE(sale->>'payment','')) LIKE '%fiado%'
        AND sale ? 'payments'
        AND jsonb_typeof(sale->'payments') IS DISTINCT FROM 'array'
    ) THEN
      RAISE EXCEPTION 'A legacy Fiado payments field is not an array for tenant %', src.owner_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(src.state->'sales', '[]'::jsonb)) sale
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(sale->'payments') = 'array' THEN sale->'payments' ELSE '[]'::jsonb END
      ) WITH ORDINALITY receipt
      WHERE lower(COALESCE(sale->>'payment','')) LIKE '%fiado%'
        AND (
          jsonb_typeof(receipt.value) <> 'object'
          OR NOT (receipt.value ? 'value')
          OR COALESCE(receipt.value->>'value','') !~ '^[0-9]+([.][0-9]+)?$'
          OR (receipt.value->>'value')::numeric <= 0
          OR NOT (receipt.value ? 'date')
          OR NOT pg_input_is_valid(receipt.value->>'date', 'timestamp with time zone')
        )
    ) THEN
      RAISE EXCEPTION 'A legacy Fiado receipt has an invalid amount or date for tenant %', src.owner_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(src.state->'sales', '[]'::jsonb)) sale
      WHERE lower(COALESCE(sale->>'payment','')) LIKE '%fiado%'
        AND COALESCE((
          SELECT SUM((receipt.value->>'value')::numeric)
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(sale->'payments') = 'array' THEN sale->'payments' ELSE '[]'::jsonb END
          ) receipt
        ),0) > COALESCE(NULLIF(sale->>'total','')::numeric,0) + 0.005
    ) THEN
      RAISE EXCEPTION 'Legacy Fiado receipts exceed the sale total for tenant %; reconcile explicitly', src.owner_id;
    END IF;

    -- Products first; their current stock is copied as the authoritative starting balance.
    INSERT INTO public.products (
      tenant_id,id,code,name,reference,unit,price,cost,stock,min_stock,category,active
    )
    SELECT
      src.owner_id,
      p->>'id',
      COALESCE(p->>'code',''),
      COALESCE(p->>'name',''),
      NULLIF(p->>'ref',''),
      COALESCE(p->>'unit','un'),
      COALESCE(NULLIF(p->>'price','')::numeric,0),
      COALESCE(NULLIF(p->>'cost','')::numeric,0),
      COALESCE(NULLIF(p->>'stock','')::numeric,0),
      COALESCE(NULLIF(p->>'minStock','')::numeric,0),
      NULLIF(p->>'category',''),
      COALESCE((p->>'active')::boolean,true)
    FROM jsonb_array_elements(COALESCE(src.state->'products','[]'::jsonb)) p;

    INSERT INTO public.product_barcodes (tenant_id,id,product_id,barcode,is_primary)
    SELECT src.owner_id,
      (p->>'id') || ':barcode:' || b.barcode,
      p->>'id',
      b.barcode,
      b.ordinality = 1
    FROM jsonb_array_elements(COALESCE(src.state->'products','[]'::jsonb)) p
    CROSS JOIN LATERAL (
      SELECT CASE WHEN jsonb_typeof(value)='string' THEN trim(both '"' from value::text)
                  ELSE COALESCE(value->>'barcode', value->>'code', value->>'value','') END AS barcode,
             ordinality
      FROM jsonb_array_elements(COALESCE(p->'barcodes','[]'::jsonb)) WITH ORDINALITY
    ) b
    WHERE b.barcode <> '';

    -- Cash sessions are imported before sales to satisfy their optional FK.
    INSERT INTO public.cash_sessions (
      tenant_id,id,operator_profile_id,operator_snapshot,status,opening_amount,opened_at,
      opening_note,closed_at,closed_by_snapshot,counted_amount,expected_amount,difference_amount,closing_note,close_idempotency_key
    )
    SELECT src.owner_id,cash->>'id',p.id,COALESCE(cash->>'openedBy',p.username),
      CASE WHEN cash->>'status'='closed' THEN 'closed' ELSE 'open' END,
      COALESCE(NULLIF(cash->>'openingAmount','')::numeric,0),
      COALESCE(NULLIF(cash->>'openedAt','')::timestamptz,src.updated_at),
      NULLIF(cash->>'openingNote',''),
      CASE WHEN cash->>'status'='closed' THEN (cash->>'closedAt')::timestamptz ELSE NULL END,
      NULLIF(cash->>'closedBy',''),
      CASE WHEN cash->>'status'='closed' THEN (cash->>'countedCash')::numeric ELSE NULL END,
      NULLIF(cash->>'expectedCash','')::numeric,
      NULLIF(cash->>'difference','')::numeric,
      NULLIF(cash->>'closingNote',''),
      CASE WHEN cash->>'status'='closed' THEN md5(src.owner_id::text||':legacy-cash-close:'||(cash->>'id'))::uuid ELSE NULL END
    FROM jsonb_array_elements(COALESCE(src.state->'cashSessions','[]'::jsonb)) cash
    JOIN LATERAL (
      SELECT id,username FROM public.profiles
      WHERE account_id=src.owner_id
        AND (lower(username)=lower(COALESCE(cash->>'openedBy',''))
          OR lower(COALESCE(display_name,''))=lower(COALESCE(cash->>'openedBy','')))
      ORDER BY (lower(username)=lower(COALESCE(cash->>'openedBy',''))) DESC
      LIMIT 1
    ) p ON true;

    -- Completed sales and immutable line/payment snapshots.
    INSERT INTO public.sales (
      tenant_id,id,cash_session_id,seller_profile_id,seller_snapshot,status,payment_status,paid_at,
      hidden_from_fiado,payment_method,occurred_at,subtotal,discount_amount,discount_type,total,
      cost_total,profit_total,idempotency_key
    )
    SELECT src.owner_id,sale->>'id',
      CASE WHEN EXISTS (SELECT 1 FROM public.cash_sessions cs WHERE cs.tenant_id=src.owner_id AND cs.id=sale->>'cashSessionId')
        THEN sale->>'cashSessionId' ELSE NULL END,
      p.id,COALESCE(sale->>'seller',p.username),
      CASE WHEN lower(COALESCE(sale->>'status','')) IN ('cancelled','canceled','estornada') OR COALESCE((sale->>'cancelled')::boolean,false)
        THEN 'cancelled' ELSE 'completed' END,
      CASE
        WHEN lower(COALESCE(sale->>'payment','')) LIKE '%fiado%' THEN
          CASE
            WHEN COALESCE((SELECT SUM((receipt.value->>'value')::numeric)
              FROM jsonb_array_elements(COALESCE(sale->'payments','[]'::jsonb)) receipt),0)
              >= COALESCE(NULLIF(sale->>'total','')::numeric,0) - 0.005
              AND COALESCE(NULLIF(sale->>'total','')::numeric,0) > 0 THEN 'paid'
            WHEN COALESCE((SELECT SUM((receipt.value->>'value')::numeric)
              FROM jsonb_array_elements(COALESCE(sale->'payments','[]'::jsonb)) receipt),0) > 0 THEN 'partial'
            ELSE 'unpaid'
          END
        WHEN COALESCE((sale->>'paid')::boolean,false) THEN 'paid'
        WHEN COALESCE(NULLIF(sale->>'received','')::numeric,0)>0 THEN 'partial'
        ELSE 'unpaid'
      END,
      CASE
        WHEN lower(COALESCE(sale->>'payment','')) LIKE '%fiado%' THEN
          CASE WHEN COALESCE((SELECT SUM((receipt.value->>'value')::numeric)
            FROM jsonb_array_elements(COALESCE(sale->'payments','[]'::jsonb)) receipt),0)
            >= COALESCE(NULLIF(sale->>'total','')::numeric,0) - 0.005
            AND COALESCE(NULLIF(sale->>'total','')::numeric,0) > 0
          THEN (SELECT MAX((receipt.value->>'date')::timestamptz)
            FROM jsonb_array_elements(COALESCE(sale->'payments','[]'::jsonb)) receipt)
          ELSE NULL END
        ELSE NULLIF(sale->>'paidAt','')::timestamptz
      END,
      COALESCE((sale->>'hiddenFromFiado')::boolean,false),
      CASE
        WHEN lower(sale->>'payment') LIKE '%dinheiro%' OR lower(sale->>'payment') LIKE '%cash%' THEN 'cash'
        WHEN lower(sale->>'payment') LIKE '%pix%' THEN 'pix'
        WHEN lower(sale->>'payment') LIKE '%cart%' OR lower(sale->>'payment') LIKE '%card%' OR lower(sale->>'payment') LIKE '%credi%' THEN 'card'
        ELSE 'fiado'
      END,
      COALESCE(NULLIF(sale->>'date','')::timestamptz,src.updated_at),
      COALESCE(NULLIF(sale->>'subtotal','')::numeric,NULLIF(sale->>'total','')::numeric,0),
      COALESCE(NULLIF(sale->>'discount','')::numeric,0),
      CASE WHEN lower(COALESCE(sale->>'discountType','')) IN ('r$','fixed','valor') THEN 'fixed'
           WHEN lower(COALESCE(sale->>'discountType','')) IN ('%','percentage','porcentagem') THEN 'percentage' ELSE NULL END,
      COALESCE(NULLIF(sale->>'total','')::numeric,0),
      COALESCE((SELECT SUM(COALESCE(NULLIF(item->>'cost','')::numeric,0)*COALESCE(NULLIF(item->>'qty','')::numeric,0))
        FROM jsonb_array_elements(COALESCE(sale->'items','[]'::jsonb)) item),0),
      COALESCE(NULLIF(sale->>'profit','')::numeric,0),
      md5(src.owner_id::text||':legacy-sale:'||(sale->>'id'))::uuid
    FROM jsonb_array_elements(COALESCE(src.state->'sales','[]'::jsonb)) sale
    JOIN LATERAL (
      SELECT id,username FROM public.profiles
      WHERE account_id=src.owner_id
        AND (lower(username)=lower(COALESCE(sale->>'seller',''))
          OR lower(COALESCE(display_name,''))=lower(COALESCE(sale->>'seller','')))
      ORDER BY (lower(username)=lower(COALESCE(sale->>'seller',''))) DESC
      LIMIT 1
    ) p ON true;

    INSERT INTO public.sale_items (
      tenant_id,id,sale_id,product_id,product_code_snapshot,product_name_snapshot,unit,
      quantity,unit_price,unit_cost,line_discount,line_total,line_cost,line_key
    )
    SELECT src.owner_id,(sale->>'id')||':line:'||item.ordinality::text,sale->>'id',
      CASE WHEN EXISTS (SELECT 1 FROM public.products pr WHERE pr.tenant_id=src.owner_id AND pr.id=item.value->>'productId')
        THEN item.value->>'productId' ELSE NULL END,
      COALESCE(pr.code,item.value->>'code',''),
      COALESCE(item.value->>'name',pr.name,''),
      CASE WHEN item.value->>'unit' IN ('kg','un') THEN item.value->>'unit' ELSE COALESCE(pr.unit,'un') END,
      COALESCE(NULLIF(item.value->>'qty','')::numeric,0),
      COALESCE(NULLIF(item.value->>'price','')::numeric,0),
      COALESCE(NULLIF(item.value->>'cost','')::numeric,0),
      COALESCE(NULLIF(item.value->>'discount','')::numeric,0),
      COALESCE(NULLIF(item.value->>'total','')::numeric,
        COALESCE(NULLIF(item.value->>'price','')::numeric,0)*COALESCE(NULLIF(item.value->>'qty','')::numeric,0)),
      COALESCE(NULLIF(item.value->>'cost','')::numeric,0)*COALESCE(NULLIF(item.value->>'qty','')::numeric,0),
      item.ordinality::text
    FROM jsonb_array_elements(COALESCE(src.state->'sales','[]'::jsonb)) sale
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sale->'items','[]'::jsonb)) WITH ORDINALITY item
    LEFT JOIN public.products pr ON pr.tenant_id=src.owner_id AND pr.id=item.value->>'productId';

    INSERT INTO public.sale_payments (
      tenant_id,id,sale_id,method,amount,received_amount,change_amount,occurred_at,idempotency_key
    )
    SELECT src.owner_id,(sale->>'id')||':payment:1',sale->>'id',
      CASE
        WHEN lower(sale->>'payment') LIKE '%dinheiro%' OR lower(sale->>'payment') LIKE '%cash%' THEN 'cash'
        WHEN lower(sale->>'payment') LIKE '%pix%' THEN 'pix'
        WHEN lower(sale->>'payment') LIKE '%cart%' OR lower(sale->>'payment') LIKE '%card%' THEN 'card'
        ELSE 'fiado'
      END,
      COALESCE(NULLIF(sale->>'total','')::numeric,0),
      NULLIF(sale->>'received','')::numeric,
      GREATEST(COALESCE(NULLIF(sale->>'received','')::numeric,0)-COALESCE(NULLIF(sale->>'total','')::numeric,0),0),
      COALESCE(NULLIF(sale->>'paidAt','')::timestamptz,NULLIF(sale->>'date','')::timestamptz,src.updated_at),
      md5(src.owner_id::text||':legacy-payment:'||(sale->>'id'))::uuid
    FROM jsonb_array_elements(COALESCE(src.state->'sales','[]'::jsonb)) sale;

    -- One relational row per historical installment, retaining its exact value
    -- and timestamp. The legacy model did not capture tender type or collector,
    -- so mark those fields explicitly as unknown instead of fabricating them.
    INSERT INTO public.receivable_payments (
      tenant_id,id,sale_id,amount,payment_method,operator_profile_id,operator_snapshot,
      occurred_at,idempotency_key
    )
    SELECT src.owner_id,
      (sale->>'id') || ':receivable:' || receipt.ordinality::text,
      sale->>'id',
      (receipt.value->>'value')::numeric,
      'legacy_unknown',
      NULL,
      'Não registrado no histórico legado',
      (receipt.value->>'date')::timestamptz,
      md5(src.owner_id::text || ':legacy-receivable:' || (sale->>'id') || ':' || receipt.ordinality::text)::uuid
    FROM jsonb_array_elements(COALESCE(src.state->'sales','[]'::jsonb)) sale
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(sale->'payments') = 'array' THEN sale->'payments' ELSE '[]'::jsonb END
    ) WITH ORDINALITY receipt
    WHERE lower(COALESCE(sale->>'payment','')) LIKE '%fiado%';

    INSERT INTO public.cash_movements (
      tenant_id,id,cash_session_id,movement_type,amount,reason,operator_profile_id,operator_snapshot,
      occurred_at,idempotency_key
    )
    SELECT src.owner_id,COALESCE(m->>'id',md5(src.owner_id::text||':legacy-cash-movement:'||m::text)),
      m->>'sessionId',
      CASE WHEN lower(COALESCE(m->>'type',m->>'movementType','')) IN ('addition','reforco','entrada') THEN 'addition' ELSE 'withdrawal' END,
      COALESCE(NULLIF(m->>'amount','')::numeric,0),
      COALESCE(NULLIF(m->>'reason',''),'Movimentação importada'),
      p.id,COALESCE(m->>'operator',p.username),
      COALESCE(NULLIF(m->>'date','')::timestamptz,src.updated_at),
      md5(src.owner_id::text||':legacy-cash-movement-key:'||COALESCE(m->>'id',m::text))::uuid
    FROM jsonb_array_elements(COALESCE(src.state->'cashMovements','[]'::jsonb)) m
    JOIN LATERAL (
      SELECT id,username FROM public.profiles
      WHERE account_id=src.owner_id
        AND (lower(username)=lower(COALESCE(m->>'operator',''))
          OR lower(COALESCE(display_name,''))=lower(COALESCE(m->>'operator','')))
      ORDER BY (lower(username)=lower(COALESCE(m->>'operator',''))) DESC
      LIMIT 1
    ) p ON true
    WHERE EXISTS (SELECT 1 FROM public.cash_sessions cs WHERE cs.tenant_id=src.owner_id AND cs.id=m->>'sessionId');

    -- Preserve the legacy ledger exactly as supplied, but do not claim it is a
    -- server-verified immutable ledger: its source was a mutable JSON snapshot.
    INSERT INTO public.stock_movements (
      tenant_id,id,operation_id,operation_type,line_key,product_id,product_code,product_name,unit,
      quantity,total_value,stock_before,stock_after,delta,operator_profile_id,operator_snapshot,
      details,occurred_at,source_kind,source_legacy_id,reconstruction_version,source_hash
    )
    SELECT src.owner_id,m->>'id',
      COALESCE(m->>'operationId',m->>'id'),
      COALESCE(m->>'type','legacy'),
      m->>'id',
      CASE WHEN EXISTS (SELECT 1 FROM public.products pr WHERE pr.tenant_id=src.owner_id AND pr.id=m->>'productId')
        THEN m->>'productId' ELSE NULL END,
      NULLIF(m->>'productCode',''),
      COALESCE(m->>'productName','Produto não identificado'),
      CASE WHEN m->>'unit' IN ('kg','un') THEN m->>'unit' ELSE 'un' END,
      COALESCE(NULLIF(m->>'quantity','')::numeric,0),
      COALESCE(NULLIF(m->>'totalValue','')::numeric,0),
      NULLIF(m->>'stockBefore','')::numeric,
      NULLIF(m->>'stockAfter','')::numeric,
      COALESCE(NULLIF(m->>'delta','')::numeric,0),
      op.id,COALESCE(m->>'operator',op.username),
      NULLIF(m->>'details',''),
      COALESCE(NULLIF(m->>'date','')::timestamptz,src.updated_at),
      'legacy_reconstructed',m->>'id',1,md5(m::text)
    FROM jsonb_array_elements(COALESCE(src.state->'stockMovements','[]'::jsonb)) m
    LEFT JOIN LATERAL (
      SELECT id,username FROM public.profiles
      WHERE account_id=src.owner_id
        AND (lower(username)=lower(COALESCE(m->>'operator',''))
          OR lower(COALESCE(display_name,''))=lower(COALESCE(m->>'operator','')))
      ORDER BY (lower(username)=lower(COALESCE(m->>'operator',''))) DESC
      LIMIT 1
    ) op ON true;

    INSERT INTO public.promotions (
      tenant_id,id,product_id,product_name_snapshot,original_price,promo_price,starts_at,ends_at
    )
    SELECT src.owner_id,promo->>'id',
      CASE WHEN EXISTS (SELECT 1 FROM public.products pr WHERE pr.tenant_id=src.owner_id AND pr.id=promo->>'productId')
        THEN promo->>'productId' ELSE NULL END,
      COALESCE(promo->>'productName',''),
      COALESCE(NULLIF(promo->>'originalPrice','')::numeric,0),
      COALESCE(NULLIF(promo->>'promoPrice','')::numeric,0),
      NULLIF(promo->>'startsAt','')::timestamptz,
      NULLIF(promo->>'endsAt','')::timestamptz
    FROM jsonb_array_elements(COALESCE(src.state->'promotions','[]'::jsonb)) promo;

    GET DIAGNOSTICS v_count_promotions = ROW_COUNT;
    SELECT count(*) INTO v_count_products FROM public.products WHERE tenant_id=src.owner_id;
    SELECT count(*) INTO v_count_sales FROM public.sales WHERE tenant_id=src.owner_id;
    SELECT count(*) INTO v_count_cash_sessions FROM public.cash_sessions WHERE tenant_id=src.owner_id;
    SELECT count(*) INTO v_count_cash_movements FROM public.cash_movements WHERE tenant_id=src.owner_id;
    SELECT count(*) INTO v_count_stock_movements FROM public.stock_movements WHERE tenant_id=src.owner_id;
    SELECT count(*) INTO v_count_receivable_payments FROM public.receivable_payments WHERE tenant_id=src.owner_id;

    INSERT INTO public.mobflow_legacy_backfill_runs (
      tenant_id,source_updated_at,source_hash,products_count,sales_count,cash_sessions_count,
      cash_movements_count,stock_movements_count,promotions_count,receivable_payments_count
    ) VALUES (
      src.owner_id,src.updated_at,v_hash,v_count_products,v_count_sales,v_count_cash_sessions,
      v_count_cash_movements,v_count_stock_movements,v_count_promotions,v_count_receivable_payments
    );
  END LOOP;
END
$backfill$;

COMMIT;

-- After validation, bootstrap must return the relational projections plus the
-- non-relational manual-sync snapshot and a cursor read atomically with the data.
-- This migration intentionally does not delete app_state or emit fake historical events.

          OR (receipt.value->>'value')::numeric <= 0
          OR NOT (receipt.value ? 'date')
          OR NOT pg_input_is_valid(receipt.value->>'date', 'timestamp with time zone')
        )
    ) THEN
      RAISE EXCEPTION 'A legacy Fiado receipt has an invalid amount or date for tenant %', src.owner_id;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(src.state->'sales', '[]'::jsonb)) sale
      WHERE lower(COALESCE(sale->>'payment','')) LIKE '%fiado%'
        AND COALESCE((
          SELECT SUM((receipt.value->>'value')::numeric)
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(sale->'payments') = 'array' THEN sale->'payments' ELSE '[]'::jsonb END
          ) receipt
        ),0) > COALESCE(NULLIF(sale->>'total','')::numeric,0) + 0.005
    ) THEN
      RAISE EXCEPTION 'Legacy Fiado receipts exceed the sale total for tenant %; reconcile explicitly', src.owner_id;
    END IF;

    -- Products first; their current stock is copied as the authoritative starting balance.
    INSERT INTO public.products (
      tenant_id,id,code,name,reference,unit,price,cost,stock,min_stock,category,active
    )
    SELECT
      src.owner_id,
      p->>'id',
      COALESCE(p->>'code',''),
      COALESCE(p->>'name',''),
      NULLIF(p->>'ref',''),
      COALESCE(p->>'unit','un'),
      COALESCE(NULLIF(p->>'price','')::numeric,0),
      COALESCE(NULLIF(p->>'cost','')::numeric,0),
      COALESCE(NULLIF(p->>'stock','')::numeric,0),
      COALESCE(NULLIF(p->>'minStock','')::numeric,0),
      NULLIF(p->>'category',''),
      COALESCE((p->>'active')::boolean,true)
    FROM jsonb_array_elements(COALESCE(src.state->'products','[]'::jsonb)) p;

    INSERT INTO public.product_barcodes (tenant_id,id,product_id,barcode,is_primary)
    SELECT src.owner_id,
      (p->>'id') || ':barcode:' || b.barcode,
      p->>'id',
      b.barcode,
      b.ordinality = 1
    FROM jsonb_array_elements(COALESCE(src.state->'products','[]'::jsonb)) p
    CROSS JOIN LATERAL (
      SELECT CASE WHEN jsonb_typeof(value)='string' THEN trim(both '"' from value::text)
                  ELSE COALESCE(value->>'barcode', value->>'code', value->>'value','') END AS barcode,
             ordinality
      FROM jsonb_array_elements(COALESCE(p->'barcodes','[]'::jsonb)) WITH ORDINALITY
    ) b
    WHERE b.barcode <> '';

    -- Cash sessions are imported before sales to satisfy their optional FK.
    INSERT INTO public.cash_sessions (
      tenant_id,id,operator_profile_id,operator_snapshot,status,opening_amount,opened_at,
      opening_note,closed_at,closed_by_snapshot,counted_amount,expected_amount,difference_amount,closing_note,close_idempotency_key
    )
    SELECT src.owner_id,cash->>'id',p.id,COALESCE(cash->>'openedBy',p.username),
      CASE WHEN cash->>'status'='closed' THEN 'closed' ELSE 'open' END,
      COALESCE(NULLIF(cash->>'openingAmount','')::numeric,0),
      COALESCE(NULLIF(cash->>'openedAt','')::timestamptz,src.updated_at),
      NULLIF(cash->>'openingNote',''),
      CASE WHEN cash->>'status'='closed' THEN (cash->>'closedAt')::timestamptz ELSE NULL END,
      NULLIF(cash->>'closedBy',''),
      CASE WHEN cash->>'status'='closed' THEN (cash->>'countedCash')::numeric ELSE NULL END,
      NULLIF(cash->>'expectedCash','')::numeric,
      NULLIF(cash->>'difference','')::numeric,
      NULLIF(cash->>'closingNote',''),
      CASE WHEN cash->>'status'='closed' THEN md5(src.owner_id::text||':legacy-cash-close:'||(cash->>'id'))::uuid ELSE NULL END
    FROM jsonb_array_elements(COALESCE(src.state->'cashSessions','[]'::jsonb)) cash
    JOIN LATERAL (
      SELECT id,username FROM public.profiles
      WHERE account_id=src.owner_id
        AND (lower(username)=lower(COALESCE(cash->>'openedBy',''))
          OR lower(COALESCE(display_name,''))=lower(COALESCE(cash->>'openedBy','')))
      ORDER BY (lower(username)=lower(COALESCE(cash->>'openedBy',''))) DESC
      LIMIT 1
    ) p ON true;

    -- Completed sales and immutable line/payment snapshots.
    INSERT INTO public.sales (
      tenant_id,id,cash_session_id,seller_profile_id,seller_snapshot,status,payment_status,paid_at,
      hidden_from_fiado,payment_method,occurred_at,subtotal,discount_amount,discount_type,total,
      cost_total,profit_total,idempotency_key
    )
    SELECT src.owner_id,sale->>'id',
      CASE WHEN EXISTS (SELECT 1 FROM public.cash_sessions cs WHERE cs.tenant_id=src.owner_id AND cs.id=sale->>'cashSessionId')
        THEN sale->>'cashSessionId' ELSE NULL END,
      p.id,COALESCE(sale->>'seller',p.username),
      CASE WHEN lower(COALESCE(sale->>'status','')) IN ('cancelled','canceled','estornada') OR COALESCE((sale->>'cancelled')::boolean,false)
        THEN 'cancelled' ELSE 'completed' END,
      CASE WHEN COALESCE((sale->>'paid')::boolean,false) THEN 'paid'
           WHEN COALESCE(NULLIF(sale->>'received','')::numeric,0)>0 THEN 'partial' ELSE 'unpaid' END,
      NULLIF(sale->>'paidAt','')::timestamptz,
      COALESCE((sale->>'hiddenFromFiado')::boolean,false),
      CASE
        WHEN lower(sale->>'payment') LIKE '%dinheiro%' OR lower(sale->>'payment') LIKE '%cash%' THEN 'cash'
        WHEN lower(sale->>'payment') LIKE '%pix%' THEN 'pix'
        WHEN lower(sale->>'payment') LIKE '%cart%' OR lower(sale->>'payment') LIKE '%card%' OR lower(sale->>'payment') LIKE '%credi%' THEN 'card'
        ELSE 'fiado'
      END,
      COALESCE(NULLIF(sale->>'date','')::timestamptz,src.updated_at),
      COALESCE(NULLIF(sale->>'subtotal','')::numeric,NULLIF(sale->>'total','')::numeric,0),
      COALESCE(NULLIF(sale->>'discount','')::numeric,0),
      CASE WHEN lower(COALESCE(sale->>'discountType','')) IN ('r$','fixed','valor') THEN 'fixed'
           WHEN lower(COALESCE(sale->>'discountType','')) IN ('%','percentage','porcentagem') THEN 'percentage' ELSE NULL END,
      COALESCE(NULLIF(sale->>'total','')::numeric,0),
      COALESCE((SELECT SUM(COALESCE(NULLIF(item->>'cost','')::numeric,0)*COALESCE(NULLIF(item->>'qty','')::numeric,0))
        FROM jsonb_array_elements(COALESCE(sale->'items','[]'::jsonb)) item),0),
      COALESCE(NULLIF(sale->>'profit','')::numeric,0),
      md5(src.owner_id::text||':legacy-sale:'||(sale->>'id'))::uuid
    FROM jsonb_array_elements(COALESCE(src.state->'sales','[]'::jsonb)) sale
    JOIN LATERAL (
      SELECT id,username FROM public.profiles
      WHERE account_id=src.owner_id
        AND (lower(username)=lower(COALESCE(sale->>'seller',''))
          OR lower(COALESCE(display_name,''))=lower(COALESCE(sale->>'seller','')))
      ORDER BY (lower(username)=lower(COALESCE(sale->>'seller',''))) DESC
      LIMIT 1
    ) p ON true;

    INSERT INTO public.sale_items (
      tenant_id,id,sale_id,product_id,product_code_snapshot,product_name_snapshot,unit,
      quantity,unit_price,unit_cost,line_discount,line_total,line_cost,line_key
    )
    SELECT src.owner_id,(sale->>'id')||':line:'||item.ordinality::text,sale->>'id',
      CASE WHEN EXISTS (SELECT 1 FROM public.products pr WHERE pr.tenant_id=src.owner_id AND pr.id=item.value->>'productId')
        THEN item.value->>'productId' ELSE NULL END,
      COALESCE(pr.code,item.value->>'code',''),
      COALESCE(item.value->>'name',pr.name,''),
      CASE WHEN item.value->>'unit' IN ('kg','un') THEN item.value->>'unit' ELSE COALESCE(pr.unit,'un') END,
      COALESCE(NULLIF(item.value->>'qty','')::numeric,0),
      COALESCE(NULLIF(item.value->>'price','')::numeric,0),
      COALESCE(NULLIF(item.value->>'cost','')::numeric,0),
      COALESCE(NULLIF(item.value->>'discount','')::numeric,0),
      COALESCE(NULLIF(item.value->>'total','')::numeric,
        COALESCE(NULLIF(item.value->>'price','')::numeric,0)*COALESCE(NULLIF(item.value->>'qty','')::numeric,0)),
      COALESCE(NULLIF(item.value->>'cost','')::numeric,0)*COALESCE(NULLIF(item.value->>'qty','')::numeric,0),
      item.ordinality::text
    FROM jsonb_array_elements(COALESCE(src.state->'sales','[]'::jsonb)) sale
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sale->'items','[]'::jsonb)) WITH ORDINALITY item
    LEFT JOIN public.products pr ON pr.tenant_id=src.owner_id AND pr.id=item.value->>'productId';

    INSERT INTO public.sale_payments (
      tenant_id,id,sale_id,method,amount,received_amount,change_amount,occurred_at,idempotency_key
    )
    SELECT src.owner_id,(sale->>'id')||':payment:1',sale->>'id',
      CASE
        WHEN lower(sale->>'payment') LIKE '%dinheiro%' OR lower(sale->>'payment') LIKE '%cash%' THEN 'cash'
        WHEN lower(sale->>'payment') LIKE '%pix%' THEN 'pix'
        WHEN lower(sale->>'payment') LIKE '%cart%' OR lower(sale->>'payment') LIKE '%card%' THEN 'card'
        ELSE 'fiado'
      END,
      COALESCE(NULLIF(sale->>'total','')::numeric,0),
      NULLIF(sale->>'received','')::numeric,
      GREATEST(COALESCE(NULLIF(sale->>'received','')::numeric,0)-COALESCE(NULLIF(sale->>'total','')::numeric,0),0),
      COALESCE(NULLIF(sale->>'paidAt','')::timestamptz,NULLIF(sale->>'date','')::timestamptz,src.updated_at),
      md5(src.owner_id::text||':legacy-payment:'||(sale->>'id'))::uuid
    FROM jsonb_array_elements(COALESCE(src.state->'sales','[]'::jsonb)) sale;

    INSERT INTO public.cash_movements (
      tenant_id,id,cash_session_id,movement_type,amount,reason,operator_profile_id,operator_snapshot,
      occurred_at,idempotency_key
    )
    SELECT src.owner_id,COALESCE(m->>'id',md5(src.owner_id::text||':legacy-cash-movement:'||m::text)),
      m->>'sessionId',
      CASE WHEN lower(COALESCE(m->>'type',m->>'movementType','')) IN ('addition','reforco','entrada') THEN 'addition' ELSE 'withdrawal' END,
      COALESCE(NULLIF(m->>'amount','')::numeric,0),
      COALESCE(NULLIF(m->>'reason',''),'Movimentação importada'),
      p.id,COALESCE(m->>'operator',p.username),
      COALESCE(NULLIF(m->>'date','')::timestamptz,src.updated_at),
      md5(src.owner_id::text||':legacy-cash-movement-key:'||COALESCE(m->>'id',m::text))::uuid
    FROM jsonb_array_elements(COALESCE(src.state->'cashMovements','[]'::jsonb)) m
    JOIN LATERAL (
      SELECT id,username FROM public.profiles
      WHERE account_id=src.owner_id
        AND (lower(username)=lower(COALESCE(m->>'operator',''))
          OR lower(COALESCE(display_name,''))=lower(COALESCE(m->>'operator','')))
      ORDER BY (lower(username)=lower(COALESCE(m->>'operator',''))) DESC
      LIMIT 1
    ) p ON true
    WHERE EXISTS (SELECT 1 FROM public.cash_sessions cs WHERE cs.tenant_id=src.owner_id AND cs.id=m->>'sessionId');

    -- Preserve the legacy ledger exactly as supplied, but do not claim it is a
    -- server-verified immutable ledger: its source was a mutable JSON snapshot.
    INSERT INTO public.stock_movements (
      tenant_id,id,operation_id,operation_type,line_key,product_id,product_code,product_name,unit,
      quantity,total_value,stock_before,stock_after,delta,operator_profile_id,operator_snapshot,
      details,occurred_at,source_kind,source_legacy_id,reconstruction_version,source_hash
    )
    SELECT src.owner_id,m->>'id',
      COALESCE(m->>'operationId',m->>'id'),
      COALESCE(m->>'type','legacy'),
      m->>'id',
      CASE WHEN EXISTS (SELECT 1 FROM public.products pr WHERE pr.tenant_id=src.owner_id AND pr.id=m->>'productId')
        THEN m->>'productId' ELSE NULL END,
      NULLIF(m->>'productCode',''),
      COALESCE(m->>'productName','Produto não identificado'),
      CASE WHEN m->>'unit' IN ('kg','un') THEN m->>'unit' ELSE 'un' END,
      COALESCE(NULLIF(m->>'quantity','')::numeric,0),
      COALESCE(NULLIF(m->>'totalValue','')::numeric,0),
      NULLIF(m->>'stockBefore','')::numeric,
      NULLIF(m->>'stockAfter','')::numeric,
      COALESCE(NULLIF(m->>'delta','')::numeric,0),
      op.id,COALESCE(m->>'operator',op.username),
      NULLIF(m->>'details',''),
      COALESCE(NULLIF(m->>'date','')::timestamptz,src.updated_at),
      'legacy_reconstructed',m->>'id',1,md5(m::text)
    FROM jsonb_array_elements(COALESCE(src.state->'stockMovements','[]'::jsonb)) m
    LEFT JOIN LATERAL (
      SELECT id,username FROM public.profiles
      WHERE account_id=src.owner_id
        AND (lower(username)=lower(COALESCE(m->>'operator',''))
          OR lower(COALESCE(display_name,''))=lower(COALESCE(m->>'operator','')))
      ORDER BY (lower(username)=lower(COALESCE(m->>'operator',''))) DESC
      LIMIT 1
    ) op ON true;

    INSERT INTO public.promotions (
      tenant_id,id,product_id,product_name_snapshot,original_price,promo_price,starts_at,ends_at
    )
    SELECT src.owner_id,promo->>'id',
      CASE WHEN EXISTS (SELECT 1 FROM public.products pr WHERE pr.tenant_id=src.owner_id AND pr.id=promo->>'productId')
        THEN promo->>'productId' ELSE NULL END,
      COALESCE(promo->>'productName',''),
      COALESCE(NULLIF(promo->>'originalPrice','')::numeric,0),
      COALESCE(NULLIF(promo->>'promoPrice','')::numeric,0),
      NULLIF(promo->>'startsAt','')::timestamptz,
      NULLIF(promo->>'endsAt','')::timestamptz
    FROM jsonb_array_elements(COALESCE(src.state->'promotions','[]'::jsonb)) promo;

    GET DIAGNOSTICS v_count_promotions = ROW_COUNT;
    SELECT count(*) INTO v_count_products FROM public.products WHERE tenant_id=src.owner_id;
    SELECT count(*) INTO v_count_sales FROM public.sales WHERE tenant_id=src.owner_id;
    SELECT count(*) INTO v_count_cash_sessions FROM public.cash_sessions WHERE tenant_id=src.owner_id;
    SELECT count(*) INTO v_count_cash_movements FROM public.cash_movements WHERE tenant_id=src.owner_id;
    SELECT count(*) INTO v_count_stock_movements FROM public.stock_movements WHERE tenant_id=src.owner_id;

    INSERT INTO public.mobflow_legacy_backfill_runs (
      tenant_id,source_updated_at,source_hash,products_count,sales_count,cash_sessions_count,
      cash_movements_count,stock_movements_count,promotions_count
    ) VALUES (
      src.owner_id,src.updated_at,v_hash,v_count_products,v_count_sales,v_count_cash_sessions,
      v_count_cash_movements,v_count_stock_movements,v_count_promotions
    );
  END LOOP;
END
$backfill$;

COMMIT;

-- After validation, bootstrap must return the relational projections plus the
-- non-relational manual-sync snapshot and a cursor read atomically with the data.
-- This migration intentionally does not delete app_state or emit fake historical events.
