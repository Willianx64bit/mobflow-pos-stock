-- Billing plans: keep existing monthly price and Pix configuration intact.
-- New prices remain NULL until an administrator explicitly configures them.
ALTER TABLE public.admin_billing_settings
  ADD COLUMN IF NOT EXISTS semiannual_price numeric(10,2)
  CHECK (semiannual_price IS NULL OR (semiannual_price > 0 AND semiannual_price <= 9999.99));

ALTER TABLE public.admin_billing_settings
  ADD COLUMN IF NOT EXISTS annual_price numeric(10,2)
  CHECK (annual_price IS NULL OR (annual_price > 0 AND annual_price <= 9999.99));
