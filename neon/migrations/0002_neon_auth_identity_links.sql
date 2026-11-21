-- MobFlow PDV / Neon migration 0002
-- Maps Managed Neon Auth string IDs to stable MobFlow profile UUIDs.
-- This preserves the app's existing profile/account identifiers and avoids
-- assuming Better Auth user IDs are UUIDs.

BEGIN;

CREATE TABLE public.auth_identity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  auth_user_id text NOT NULL,
  profile_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_identity_links_provider_check CHECK (provider IN ('neon')),
  CONSTRAINT auth_identity_links_provider_user_key UNIQUE (provider, auth_user_id),
  CONSTRAINT auth_identity_links_provider_profile_key UNIQUE (provider, profile_id),
  CONSTRAINT auth_identity_links_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE INDEX auth_identity_links_profile_id_idx
  ON public.auth_identity_links USING btree (profile_id);

ALTER TABLE public.auth_identity_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_identity_links FROM PUBLIC;

COMMIT;
