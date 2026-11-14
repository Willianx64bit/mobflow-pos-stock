-- Reconcile the migration Preview's public billing value with the
-- original MobFlow Admin Supabase setting (R$ 49,90).
-- Preview-only data correction; do not apply to Production without review.
UPDATE public.admin_billing_settings
SET monthly_price = 49.90,
    updated_at = now(),
    updated_by = 'williannunesx456@gmail.com'
WHERE id = true
  AND monthly_price IS DISTINCT FROM 49.90;