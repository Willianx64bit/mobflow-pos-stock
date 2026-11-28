-- Store the selected subscription period and the exact amount charged at signup.
-- Existing companies remain NULL here; their legacy monthly behavior and dates are unchanged.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS subscription_plan_code text
    CHECK (subscription_plan_code IS NULL OR subscription_plan_code IN ('monthly','semiannual','annual')),
  ADD COLUMN IF NOT EXISTS subscription_months integer
    CHECK (subscription_months IS NULL OR subscription_months IN (1,6,12)),
  ADD COLUMN IF NOT EXISTS contracted_amount numeric(10,2)
    CHECK (contracted_amount IS NULL OR (contracted_amount > 0 AND contracted_amount <= 9999.99));

