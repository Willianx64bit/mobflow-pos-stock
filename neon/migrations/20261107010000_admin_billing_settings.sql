-- MobFlow Admin billing settings shared with the PDV signup flow.
-- Apply only to the isolated Neon migration/QA database during validation.
CREATE TABLE IF NOT EXISTS public.admin_billing_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  monthly_price numeric(12,2) NOT NULL CHECK (monthly_price > 0 AND monthly_price <= 9999.99),
  payment_method text NOT NULL DEFAULT 'pix' CHECK (payment_method = 'pix'),
  pix_phone text NOT NULL CHECK (pix_phone ~ '^\+?[0-9]{10,15}$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

INSERT INTO public.admin_billing_settings
  (id, monthly_price, payment_method, pix_phone, updated_at, updated_by)
VALUES
  (true, 69.90, 'pix', '+5515996003161', now(), 'migration-preview-initial')
ON CONFLICT (id) DO NOTHING;
