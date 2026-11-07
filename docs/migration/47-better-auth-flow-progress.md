# 47 — MobFlow PDV: Better Auth flow progress

## Scope and safety

This work remains exclusively on `migration/neon-preparation` in the MobFlow
PDV repository. No work was performed on MobFlow Admin or ColetaFlow.

- No production Vercel deployment or branch merge.
- No Vercel environment variables changed.
- No production database migration or cleanup.
- No Supabase account, password hash, or session copied.
- No user password reset or user deletion executed.

## Auth implementation now present in the branch

### Better Auth core

- Self-managed Better Auth is pinned to version `1.7.18`.
- Password hashing and verification use bcryptjs cost 12, compatible with
  existing Supabase bcrypt hashes.
- Better Auth sign-up is disabled; MobFlow account provisioning remains
  server-controlled.
- Existing UUID user IDs can be preserved during import.
- Better Auth cookie sessions are accepted by the Neon API authentication
  bridge; Supabase bearer-token authentication remains the default until the
  Preview-only provider flags are enabled.

### Routes ported to Neon

- `POST /api/mobflow/login`: username alias, password, CNPJ, role,
  subscription status, allowlist, first-manager bootstrap, and bcrypt check.
- `POST /api/mobflow/users`: list/create/update permissions/toggle/reset
  password/delete/delete all PDV users/reset application.
- `POST /api/mobflow/reauth-manager`: status, initial manager-security
  password setup, and SHA-256 re-authentication.
- `POST /api/mobflow/signup`: company signup, Pix generation, and manager
  bootstrap.
- `POST /api/mobflow/receiving`: transactional replacement for `accept_receiving` and `finalize_receiving_decisions`, with accepted quantities released once inside a locked app-state transaction.
- `POST /api/mobflow/manager-password-recovery`: one-time recovery token,
  rate limit, Gmail SMTP delivery, and reset of the separate manager-security
  password.
- `POST /api/mobflow/signup` also supports payment-proof upload. For now the
  file remains in the existing PDV Supabase Storage bucket so the separate
  Admin workflow can retain its existing storage contract; the company
  metadata is written to Neon.

### Client integration

The Preview flag `VITE_MOBFLOW_AUTH_PROVIDER=better-auth` switches:
- login and sign-out to Better Auth;
- app bootstrap to `/api/mobflow/session-context`;
- state API calls to same-origin HttpOnly cookies;
- manager settings, user management, manager re-authentication, receiving
  decisions, and recovery screens to the new Neon routes;
- company signup to the Neon signup route.

The default Supabase branch remains in place when the flag is absent.

## Neon test database

The isolated PostgreSQL 18 test branch has the Better Auth core tables:
`user`, `account`, `session`, and `verification`. They contain no real
accounts. The unique account identity key on (`providerId`, `accountId`) is
present. The schema migration is `neon/migrations/0004_better_auth_core_schema.sql`.

## Password import

`scripts/migrate-supabase-auth-to-better-auth.mjs` is guarded and dry-run by
default. It checks bcrypt hashes, email uniqueness, profile coverage, provider
types, and an empty target. Applying it requires both `--apply` and
`CONFIRM_AUTH_IMPORT=YES`.

It has not been run. The seven existing Supabase users and their bcrypt hashes
remain in Supabase. Existing Supabase sessions will not be copied; users will
need to sign in again after a future cutover.

## Automated validation

Latest GitHub Actions run on this branch: **success**.
- 35 unit tests passed.
- migration utility syntax check passed.
- full Vite/TanStack build passed.

The validation uses GitHub Actions, not Vercel. The Vercel build-rate-limit
issue has not been treated as a code failure.

## Dependencies still needing configuration or validation

1. `MOBFLOW_AUTH_PROVIDER=better-auth` and
   `VITE_MOBFLOW_AUTH_PROVIDER=better-auth` are not set.
2. `MOBFLOW_AUTH_DATABASE_URL`, `NEON_DATABASE_URL`,
   `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and
   `BETTER_AUTH_TRUSTED_ORIGINS` are not set for Preview.
3. Payment-proof upload requires `SUPABASE_SERVICE_ROLE_KEY` in Preview and
   successful access to the existing Supabase Storage bucket. This has not
   been tested under the current Supabase egress restriction.
4. Signup still calls the existing MobFlow Admin public billing endpoint at
   `xsitutjpdshmidzpgxpx.supabase.co`. The Supabase project listing reported
   MobFlow Admin as inactive; this dependency must be checked before enabling
   signup.

   Read-only inspection of the Admin repository also confirmed that its
   `adminApi.ts` authenticates against the Admin project's own Supabase session
   and invokes that project's `mobflow-admin-api` function. That function reads
   its own `companies` table and currently supports only `list_companies`.
   This is a separate integration contract from the PDV database. It has not
   been changed; before cutover, the user must decide how Neon company records
   will be exposed to the separate Admin project without silently changing its
   authentication or payment workflow.
5. Manager recovery email requires `GMAIL_SMTP_HOST`,
   `GMAIL_SMTP_PORT=465`, `GMAIL_SMTP_USER`,
   `GMAIL_SMTP_APP_PASSWORD`, and `MOBFLOW_APP_URL`; none were configured
   or tested here.
6. The server-only owner connection is currently used by privileged
   provisioning/management routes. Least-privilege roles and policies for
   companies, allowlist, manager security, recovery tokens, and account
   management still need a final review before Preview activation.

## Git branch safety note

Two route-file commits were briefly created on `main` because the GitHub
file-creation action defaulted to the repository's default branch when the
branch parameter was omitted. Both files were immediately removed in two
follow-up commits. Verification confirms:
- neither migration route remains in the current `main` tree;
- both routes exist on `migration/neon-preparation`;
- Vercel has no production deployment for either accidental commit SHA.

No production deployment was made from those commits. All further file changes
use explicit Git-tree commits to `migration/neon-preparation`.

## Preview environment preparation — 2026-11-06

The Vercel Preview environment variables below are now configured only for
`migration/neon-preparation`:

- `NEON_DATABASE_URL` points to the isolated PostgreSQL 18 branch
  `br-wild-night-bds1bdfk` in project `proud-star-34734307`.
- `BETTER_AUTH_SECRET` is set as an encrypted Preview-only secret.
- `BETTER_AUTH_URL` and `BETTER_AUTH_TRUSTED_ORIGINS` use the stable branch
  Preview origin.

The previous Preview `NEON_DATABASE_URL` pointed to the older PG17 test
endpoint. It was corrected so the migration branch uses the isolated PG18
test database. No Production environment variable was changed.

The provider flags `MOBFLOW_AUTH_PROVIDER` and
`VITE_MOBFLOW_AUTH_PROVIDER` are intentionally **not enabled yet**. The
account import must finish and be verified before the login cutover is enabled.

## TESTE.MOBFLOW account verification

Read-only checks on Supabase confirmed:
- original auth user ID is preserved and matches the profile UUID;
- the account is active, role `manager`, with CNPJ matching the requested
  company;
- company subscription is `active` and not expired at the time of verification;
- the supplied existing password was verified against the stored bcrypt hash
  using a boolean database-side comparison;
- a separate manager-security credential exists.

The isolated Neon target has no collision for this user ID, username, CNPJ,
company account ID, or manager-security account ID.

The actual password hash and manager-security hash were not copied. The
attempted direct credential transfer was blocked by the secure database
operation boundary. No credential material was exposed in repository files or
Preview environment values. Therefore the account import is still pending,
and the Better Auth provider flags remain off.

## Remaining migration work

- Port and verify the Admin integration without changing the Admin project
  until its token/identity contract is confirmed.
- Port `accept_receiving` and `finalize_receiving_decisions` RPCs to Neon
  transactions.
- Verify all sales, stock movements, receiving, reports, permissions, offline
  persistence, and two-device synchronization.
- Complete RLS and grants for all server routes.
- Run the guarded import in dry-run mode against the real Supabase source and
  isolated Neon target; inspect counts and conflicts before any apply.
- Configure Preview secrets only after the routes and dependencies are ready.
- Test login, payment approval, password recovery, tenant isolation, and
  rollback on Preview. Production cutover requires separate explicit approval.
