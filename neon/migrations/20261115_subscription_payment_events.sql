-- MobFlow subscription payment audit and idempotency.
-- Apply only to the MobFlow Neon Preview branch before deploying the Admin Preview.
CREATE TABLE IF NOT EXISTS public.mobflow_subscription_payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES public.companies(account_id) ON DELETE CASCADE,
  payment_request_token uuid,
  payment_type text NOT NULL CHECK (payment_type IN ('initial','renewal')),
  plan_code text NOT NULL CHECK (plan_code IN ('monthly','semiannual','annual')),
  plan_months integer NOT NULL CHECK (plan_months IN (1,6,12)),
  amount numeric(10,2) NOT NULL CHECK (amount > 0 AND amount <= 9999.99),
  previous_expires_at timestamptz,
  new_expires_at timestamptz NOT NULL,
  confirmed_by text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobflow_subscription_initial_token_unique UNIQUE (payment_request_token),
  CONSTRAINT mobflow_subscription_initial_token_required
    CHECK (payment_type <> 'initial' OR payment_request_token IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS mobflow_subscription_payment_events_account_confirmed_idx
  ON public.mobflow_subscription_payment_events (account_id, confirmed_at DESC);
