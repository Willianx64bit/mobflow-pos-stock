# 52 — Preview auth and migration-target revalidation

Date: 2026-11-07
Repository: `Willianx64bit/mobflow-pos-stock`
Git branch: `migration/neon-preparation`
Scope: read-only environment/database verification plus Preview secret-visibility hardening.

## Preview environment currently active

The branch-specific Vercel Preview environment currently has:

- `MOBFLOW_AUTH_PROVIDER=better-auth`
- `VITE_MOBFLOW_AUTH_PROVIDER=better-auth`
- `NEON_DATABASE_URL` targeting the isolated PostgreSQL 18 branch `realtime-validation` (`br-wild-night-bds1bdfk`) in project `proud-star-34734307`.
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `BETTER_AUTH_TRUSTED_ORIGINS` configured for the migration Preview origin.
- `RESEND_API_KEY` configured as a Secret.

This supersedes the older statement in document 47 that the Better Auth provider flags were still unset. The migration Preview is now running in Better Auth mode; this does not mean Production has changed.

## Secret visibility hardening

The Vercel environment-variable inventory reported `readable-secret` security issues for the Preview-only `NEON_DATABASE_URL` and `BETTER_AUTH_SECRET`, because both were stored as readable encrypted/configuration values.

Changed only their Vercel variable type to `sensitive` (Secret), preserving their existing values, Preview target, and branch scope. Re-read the variable metadata afterward:

- Both now report `type=sensitive` and `visibility=secret`.
- Neither reports a security issue.
- `RESEND_API_KEY` was already sensitive.
- No Production environment variable was changed.

The Vercel Preview deployment for commit `2a0faa13e1285059624ba7598efdd4f399a05f08` completed with state `READY`.

## Neon target verification

The exact branch referenced by Preview's `NEON_DATABASE_URL` was checked directly:

- PostgreSQL 18.6.
- Both sync tables, the append function, and all three sync RLS policies exist.
- The restricted `mobflow_api` role is neither superuser nor BYPASSRLS.
- Database-level append idempotency and tenant isolation tests passed in rollback-only PL/pgSQL blocks.
- Cross-tenant reads were hidden and a forged cross-tenant insert was rejected.
- Follow-up counts confirmed all temporary test writes were rolled back; event and counter tables remain empty.

The same idempotency and isolation checks also passed on the child branch `incremental-sync-schema-validation`.

## Better Auth destination is not empty

Read-only aggregate inspection of the Preview Neon branch found:

- 9 profiles, 2 companies, and 4 app_state rows.
- 6 Better Auth users and 6 credential account rows.
- 2 rows in `auth_identity_links`.
- The `TESTE.MOBFLOW` Preview account has a Better Auth credential, but its Neon profile/user/company/state records were created on 2026-11-07. The corresponding Supabase production profile/Auth user dates from 2026-10-06. This is a separately created Preview test account, not evidence that the original production password hash was imported.

The migration utility `scripts/migrate-supabase-auth-to-better-auth.mjs` deliberately refuses to import when the destination Better Auth user/account/session tables are not empty. It also requires `SUPABASE_DATABASE_URL` and `MOBFLOW_AUTH_DATABASE_URL`. The current Preview environment inventory does not contain those variables, and no dry-run or credential import was executed.

## Gate — do not import or cut over yet

The Preview provider flags are enabled, but the existing production users' password continuity has not been proven. The target already contains test credentials, so the guarded import cannot safely run against the current branch.

Before credential migration:
1. Preserve the current Preview branch and its test fixtures.
2. Prepare a separate clean Neon branch/database for the import rehearsal, with the Better Auth tables empty.
3. Provide the production Supabase database connection only through an approved secret channel; never paste it into chat or commit it.
4. Run the guarded utility in dry-run mode, inspect counts and ID/profile coverage, then review the exact import plan before any apply.
5. Test login, session creation, password verification, account lockout, and recovery on Preview before any Production cutover.

No Supabase production DDL/DML, production export/import, Production Vercel environment change, or Production deployment was performed in this checkpoint. MobFlow Admin and ColetaFlow remain untouched.
