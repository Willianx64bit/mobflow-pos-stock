# 43 — Neon Auth API bridge and restricted database role

Date: 2026-11-06
Branch: `migration/neon-preparation`
Neon test target: `mobflow-pdv-realtime-test` / `realtime-validation` (PostgreSQL 18.6)

## Implemented in the migration branch
- Added migration `0002_neon_auth_identity_links.sql`: maps Managed Neon Auth string subjects to the existing UUID `profiles.id`. This avoids assuming Better Auth IDs are UUIDs and preserves existing MobFlow profile/account IDs.
- Added migration `0003_runtime_role_and_auth_subject_policy.sql`: grants the application role the required limited table privileges and adds a SELECT policy so a verified Neon subject can resolve only its own identity link.
- Updated `src/lib/server/mobflow-auth.ts`:
  - keeps the existing Supabase token path as the default until the login UI is migrated;
  - adds explicit Neon mode when `MOBFLOW_AUTH_PROVIDER=neon`;
  - verifies EdDSA JWT signature against `NEON_AUTH_JWKS_URL`, issuer against `new URL(NEON_AUTH_BASE_URL).origin`, and validates subject, expiration, and not-before;
  - maps the Neon subject to a MobFlow profile through `auth_identity_links`;
  - sets transaction-local identity context only from the verified token and database profile;
  - runs database work under `SET LOCAL ROLE mobflow_api_test`, not as the database owner.
- Added unit tests for Neon JWT verification, non-UUID identity mapping, missing identity mapping, and invalid signature.
- Updated existing auth tests to account for restricted-role execution.

## Database checks performed on PG18
- Applied migrations 0002 and 0003.
- Added synthetic Neon subject mappings for two synthetic tenants.
- Under `mobflow_api_test`, the first synthetic subject could resolve exactly one identity link.
- Under the same restricted role, Tenant A manager could read only Tenant A state; cross-tenant state visibility/update returned zero rows.
- Earlier schema checks confirmed RLS enabled on all 7 public application tables.

## Compatibility and safety
- `MOBFLOW_AUTH_PROVIDER` remains unset in the existing Preview configuration, so current Supabase login behavior is retained until the frontend auth cutover is separately implemented and tested.
- No Vercel environment variables were changed. In particular, the existing `NEON_DATABASE_URL` was not redirected to the PG18 branch.
- No real user, password, company, subscription, or production data was created, altered, or deleted.
- The identity-link table currently has synthetic test mappings only; real mappings must be created by a controlled provisioning/migration flow, never from a client-supplied profile ID.
- The Vercel Preview build for the API bridge commit was observed READY. Unit tests were added but have not yet been confirmed as executed by CI.

## Next work
1. Implement controlled Neon Auth provisioning for company managers and PDV users, including payment/approval rules and identity-link creation.
2. Migrate the login UI to Neon Auth while preserving username + CNPJ + password interaction and first-manager setup.
3. Migrate user management, password recovery, manager re-authentication, admin integration, and payment workflows.
4. Only after those pass, point Preview's Neon DB URL to the PG18 branch and run end-to-end API tests.
5. Implement Realtime client integration separately; it is not a blocker for the API/auth work.
