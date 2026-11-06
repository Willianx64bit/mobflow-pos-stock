-- Self-managed Better Auth core schema for the MobFlow migration.
-- This is intentionally separate from Neon Managed Auth's neon_auth schema.
-- Application sessions and credentials are server-only; no app role receives grants.

CREATE TABLE IF NOT EXISTS public."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_email_unique"
  ON public."user" (email);

CREATE TABLE IF NOT EXISTS public."session" (
  id text PRIMARY KEY,
  "expiresAt" timestamp NOT NULL,
  token text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "session_token_unique"
  ON public."session" (token);
CREATE INDEX IF NOT EXISTS "session_userId_idx"
  ON public."session" ("userId");

CREATE TABLE IF NOT EXISTS public."account" (
  id text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamp,
  "refreshTokenExpiresAt" timestamp,
  scope text,
  password text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "account_userId_idx"
  ON public."account" ("userId");
CREATE INDEX IF NOT EXISTS "account_provider_account_idx"
  ON public."account" ("providerId", "accountId");

CREATE TABLE IF NOT EXISTS public."verification" (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now(),
  "updatedAt" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "verification_identifier_idx"
  ON public."verification" (identifier);

REVOKE ALL ON TABLE
  public."user",
  public."session",
  public."account",
  public."verification"
FROM PUBLIC;
