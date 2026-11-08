-- MobFlow PDV — migration 0006: operational relational foundation (DRAFT / NOT APPLIED)
-- Target: isolated Neon test branch only, after schema review and explicit approval.
-- Scope: catalog, sales/payments, cash, and auditable stock ledger.
-- This is additive: it does not alter app_state, auth, existing routes, or production.
-- IDs remain TEXT where the current client uses string IDs; tenant identity remains UUID.
-- Business-policy checks (negative stock, split tender, offline acceptance) belong to
-- transactional commands and are intentionally not decided by this schema.

BEGIN;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  tenant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  reference text,
  unit text NOT NULL CHECK (unit IN ('un', 'kg')),
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  stock numeric(14,3) NOT NULL DEFAULT 0,
  min_stock numeric(14,3) NOT NULL DEFAULT 0,
  category text,
  photo_object_key text,
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS products_tenant_code_idx
  ON public.products (tenant_id, lower(code));
CREATE INDEX IF NOT EXISTS products_tenant_name_idx
  ON public.products (tenant_id, lower(name));

CREATE TABLE IF NOT EXISTS public.product_barcodes (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  product_id text NOT NULL,
  barcode text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT product_barcodes_product_fk
    FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.products(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT product_barcodes_tenant_barcode_key UNIQUE (tenant_id, barcode)
);
CREATE INDEX IF NOT EXISTS product_barcodes_product_idx
  ON public.product_barcodes (tenant_id, product_id);

-- ---------------------------------------------------------------------------
-- Cash sessions and movements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  tenant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  id text NOT NULL,
  operator_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  operator_snapshot text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  opening_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
  opened_at timestamptz NOT NULL,
  opening_note text,
  closed_at timestamptz,
  closed_by_snapshot text,
  counted_amount numeric(14,2),
  expected_amount numeric(14,2),
  difference_amount numeric(14,2),
  closing_note text,
  close_idempotency_key uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT cash_sessions_close_fields_check CHECK (
    (status = 'open' AND closed_at IS NULL AND counted_amount IS NULL)
    OR
    (status = 'closed' AND closed_at IS NOT NULL AND counted_amount IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_per_operator_uidx
  ON public.cash_sessions (tenant_id, operator_profile_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS cash_sessions_tenant_opened_idx
  ON public.cash_sessions (tenant_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.cash_movements (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  cash_session_id text NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('withdrawal', 'addition')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  operator_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  operator_snapshot text NOT NULL,
  occurred_at timestamptz NOT NULL,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT cash_movements_session_fk
    FOREIGN KEY (tenant_id, cash_session_id)
    REFERENCES public.cash_sessions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_movements_tenant_idempotency_key UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS cash_movements_session_date_idx
  ON public.cash_movements (tenant_id, cash_session_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Sales, immutable item snapshots, and payments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales (
  tenant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  id text NOT NULL,
  cash_session_id text,
  seller_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  seller_snapshot text NOT NULL,
  customer_id text,
  customer_name_snapshot text,
  customer_document_snapshot text,
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'cancelled', 'reversed')),
  payment_status text NOT NULL DEFAULT 'paid'
    CHECK (payment_status IN ('paid', 'partial', 'unpaid')),
  paid_at timestamptz,
  hidden_from_fiado boolean NOT NULL DEFAULT false,
  payment_method text NOT NULL
    CHECK (payment_method IN ('cash', 'pix', 'card', 'fiado')),
  occurred_at timestamptz NOT NULL,
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  discount_type text CHECK (discount_type IS NULL OR discount_type IN ('fixed', 'percentage')),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  cost_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost_total >= 0),
  profit_total numeric(14,2) NOT NULL DEFAULT 0,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT sales_cash_session_fk
    FOREIGN KEY (tenant_id, cash_session_id)
    REFERENCES public.cash_sessions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_tenant_idempotency_key UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS sales_tenant_date_idx
  ON public.sales (tenant_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS sales_cash_session_idx
  ON public.sales (tenant_id, cash_session_id, occurred_at);

CREATE TABLE IF NOT EXISTS public.sale_items (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  sale_id text NOT NULL,
  product_id text,
  product_code_snapshot text NOT NULL,
  product_name_snapshot text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('un', 'kg')),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  unit_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  line_discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (line_discount >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
  line_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (line_cost >= 0),
  line_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT sale_items_sale_fk
    FOREIGN KEY (tenant_id, sale_id)
    REFERENCES public.sales(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_items_sale_line_key UNIQUE (tenant_id, sale_id, line_key)
);
CREATE INDEX IF NOT EXISTS sale_items_product_idx
  ON public.sale_items (tenant_id, product_id);

CREATE TABLE IF NOT EXISTS public.sale_payments (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  sale_id text NOT NULL,
  method text NOT NULL CHECK (method IN ('cash', 'pix', 'card', 'fiado')),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  received_amount numeric(14,2),
  change_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
  occurred_at timestamptz NOT NULL,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT sale_payments_sale_fk
    FOREIGN KEY (tenant_id, sale_id)
    REFERENCES public.sales(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT sale_payments_tenant_idempotency_key UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS sale_payments_sale_idx
  ON public.sale_payments (tenant_id, sale_id, occurred_at);

CREATE TABLE IF NOT EXISTS public.receivable_payments (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  sale_id text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'pix', 'card')),
  operator_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  operator_snapshot text NOT NULL,
  occurred_at timestamptz NOT NULL,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT receivable_payments_sale_fk
    FOREIGN KEY (tenant_id, sale_id)
    REFERENCES public.sales(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT receivable_payments_tenant_idempotency_key UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS receivable_payments_sale_idx
  ON public.receivable_payments (tenant_id, sale_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Permanent stock ledger. Product references are intentionally snapshots,
-- not FKs: history survives product deletion and catalog replacement.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
  tenant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  id text NOT NULL,
  operation_id text NOT NULL,
  operation_type text NOT NULL,
  line_key text NOT NULL,
  product_id text,
  product_code text,
  product_name text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('un', 'kg')),
  quantity numeric(14,3) NOT NULL CHECK (quantity >= 0),
  total_value numeric(14,2) NOT NULL DEFAULT 0,
  stock_before numeric(14,3),
  stock_after numeric(14,3),
  delta numeric(14,3) NOT NULL,
  operator_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  operator_snapshot text,
  details text,
  occurred_at timestamptz NOT NULL,
  source_kind text NOT NULL DEFAULT 'live'
    CHECK (source_kind IN ('live', 'legacy_real', 'legacy_reconstructed')),
  source_legacy_id text,
  reconstruction_version integer,
  source_hash text,
  idempotency_key uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT stock_movements_operation_line_key
    UNIQUE (tenant_id, operation_id, line_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_legacy_source_uidx
  ON public.stock_movements (tenant_id, source_legacy_id)
  WHERE source_legacy_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_idempotency_uidx
  ON public.stock_movements (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_movements_tenant_date_idx
  ON public.stock_movements (tenant_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS stock_movements_product_date_idx
  ON public.stock_movements (tenant_id, product_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Tenant isolation. API routes must still include tenant predicates explicitly.
-- Policies rely on transaction-local app.account_id/app.user_id set by trusted API.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'products', 'product_barcodes', 'cash_sessions', 'cash_movements',
    'sales', 'sale_items', 'sale_payments', 'receivable_payments',
    'stock_movements'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_tenant_access', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO mobflow_api USING (tenant_id = NULLIF(current_setting(''app.account_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.account_id'', true), '''')::uuid)',
      v_table || '_tenant_access', v_table
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.products, public.product_barcodes,
  public.cash_sessions, public.cash_movements,
  public.sales, public.sale_items, public.sale_payments,
  public.receivable_payments, public.stock_movements
TO mobflow_api;

REVOKE ALL ON
  public.products, public.product_barcodes,
  public.cash_sessions, public.cash_movements,
  public.sales, public.sale_items, public.sale_payments,
  public.receivable_payments, public.stock_movements
FROM PUBLIC;

COMMIT;

-- Review blockers before application:
-- 1. Verify role mobflow_api exists and migration runner has ownership/DDL grants.
-- 2. Confirm actual legacy ID formats and product code/barcode uniqueness rules.
-- 3. Confirm cash-session ownership and tenant consistency for profile FKs.
-- 4. Review RLS policies/grants against the production security model.
-- 5. Add command APIs and tests before enabling these tables as authoritative.
-- 6. Do not backfill app_state until collision report and reconciliation are approved.
