-- Dedicated least-privilege role for public company onboarding and manager first-access.
-- Run only on the PDV Preview Neon branch after confirming the deployment's database.
-- Create the LOGIN role and set its password out-of-band; never commit credentials.
-- This migration intentionally contains no tenant/company INSERTs or seed data.

GRANT USAGE ON SCHEMA public TO mobflow_signup_preview;

-- Public registration reads the centrally managed Pix settings.
GRANT SELECT ON TABLE public.admin_billing_settings TO mobflow_signup_preview;

-- Public registration creates the Better Auth identity and account,
-- then creates the MobFlow profile, allowlist entry, company, and initial state.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."user",
            public."account",
            public.profiles,
            public.account_allowlist,
            public.companies,
            public.app_state
  TO mobflow_signup_preview;

-- First manager setup invalidates any existing sessions for that user.
GRANT DELETE ON TABLE public."session" TO mobflow_signup_preview;
