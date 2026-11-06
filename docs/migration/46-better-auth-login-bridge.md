# 46 — Better Auth: login bridge and test schema

## Scope

This is an isolated continuation of the MobFlow PDV Supabase → Neon migration.
All changes are on `migration/neon-preparation`; MobFlow Admin, ColetaFlow,
production deployment, and the live Supabase project remain untouched.

## What is now implemented

- Self-managed Better Auth, separate from Neon Managed Auth.
- bcrypt-compatible password hashing and verification, preserving compatibility
  with the existing Supabase bcrypt password hashes.
- Better Auth cookie-session verification in the Neon API authentication layer.
- A Neon-backed login validation route that preserves the existing username,
  CNPJ, role, company-subscription, allowlist, and first-manager checks.
- First-manager bootstrap creates a Better Auth user/account and matching
  MobFlow profile with the same UUID.
- The login screen can use Better Auth when the Preview-only
  `VITE_MOBFLOW_AUTH_PROVIDER=better-auth` flag is enabled.
- State API requests use same-origin HttpOnly cookies in Better Auth mode;
  the current Supabase bearer-token path remains the default.
- Public Better Auth sign-up is disabled. The new-company signup and payment
  workflow is intentionally hidden in Better Auth mode until its server-side
  port is complete.

## Test database schema

Migration `0004_better_auth_core_schema.sql` creates the core Better Auth
`user`, `account`, `session`, and `verification` tables on the isolated
PostgreSQL 18 Neon test branch only. The tables are empty; no live account,
password hash, or session has been copied.

The `account` table has a unique key on (`providerId`, `accountId`) and
credential accounts use `providerId='credential'` with the stable user UUID
as `accountId`. This follows the current Better Auth core schema guidance.

## Guarded password import utility

`scripts/migrate-supabase-auth-to-better-auth.mjs` is a dry-run-first utility.
It requires secure environment variables for both Postgres connections. A real
write additionally requires both `--apply` and
`CONFIRM_AUTH_IMPORT=YES`. It validates bcrypt formats, duplicate emails,
profile coverage, provider types, and an empty destination before writing.
It never prints password hashes or imports existing sessions.

The utility has **not** been executed. Real account rows and bcrypt hashes
remain in Supabase.

## Validation

The GitHub Actions workflow now validates:
- JavaScript syntax for the guarded import utility;
- unit tests for the Neon API, Better Auth session bridge, login validation,
  first-manager bootstrap, and bcrypt compatibility;
- a full Vite/TanStack application build.

The latest successful run is linked from the migration branch's Actions history.
Vercel build-rate limits are no longer a blocker for code validation.

## Environment variables — not set yet

Only after all remaining auth and application workflows are ported should the
Preview environment receive:
- `MOBFLOW_AUTH_PROVIDER=better-auth`
- `VITE_MOBFLOW_AUTH_PROVIDER=better-auth`
- `MOBFLOW_AUTH_DATABASE_URL` pointing to the Neon test branch
- `NEON_DATABASE_URL` pointing to the same test branch
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`

No environment variable was changed in this phase.

## Remaining work before Preview cutover

1. Port company signup, payment proof, and payment confirmation.
2. Port PDV user management, manager re-authentication, and password recovery.
3. Port admin integration while keeping the MobFlow Admin project separate.
4. Port receiving RPCs and verify all sales, inventory, stock movement,
   reports, and offline workflows.
5. Complete RLS policies and least-privilege grants for all management routes.
6. Run migration dry-run against the real Supabase source and isolated Neon
   destination; only then plan a controlled account import.
7. Validate login, tenant isolation, two-device synchronization, and rollback
   on Preview before asking for production cutover approval.
