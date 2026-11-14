# 45 — Authentication migration path that preserves MobFlow passwords

## Finding

The Supabase project API gateway has been returning HTTP 402 because the organization exceeded its Egress quota. The Supabase SQL tool can still read the database directly. A read-only aggregate query confirmed:

- 7 Auth users and 7 Auth identities
- 7 public profiles
- 2 companies and 2 app_state rows
- all 7 users have non-empty bcrypt-format password hashes
- all 7 profiles join to their original Auth user IDs
- all 2 companies and app_state rows join to the original Auth IDs
- 9 account_allowlist entries and 2 manager_security_by_account records
- the payment-proof Storage bucket currently has 0 objects

No user rows, password hashes, company records, or application data were changed by this audit.

## Selected path

Do **not** use Managed Neon Auth as the credential import target for this migration. Current Neon Managed Better Auth guidance says Supabase password hashes cannot be imported.

Instead, evaluate **self-managed Better Auth hosted by the existing MobFlow TanStack Start/Vercel server and backed by the Neon PostgreSQL 18 test branch**.

The current Better Auth Supabase migration guide explicitly supports:
- importing Supabase `auth.users.id` into Better Auth `user.id`;
- importing `auth.users.encrypted_password` into Better Auth `account.password`;
- configuring custom bcrypt `hash` and `verify` functions.

This is the best path to preserve existing passwords and original UUIDs. Keeping the original UUIDs is important because current MobFlow tables use those IDs in `profiles.id`, `companies.account_id`, `app_state.owner_id`, and related foreign keys.

The managed `neon_auth` schema already provisioned on the test branch will remain untouched. Self-managed Better Auth will use its own tables/schema, separate from the managed service.

## Login compatibility requirements

The existing MobFlow login is not a plain email form. It uses:
- username normalized to uppercase;
- a deterministic internal email alias: `<normalized-username>@accounts.mobflow.local`;
- CNPJ validation;
- manager vs. PDV role validation;
- active profile checks;
- company subscription status/expiry checks;
- a legacy first-manager allowlist/bootstrap path.

The new server-side login must preserve all of these checks before granting an application session. The browser must not be trusted to enforce company, CNPJ, role, or subscription restrictions.

New users must be created through controlled server-side provisioning, not public self-sign-up. The current public signup/Pix/payment/first-manager setup flow must remain intact.

## Existing Supabase-dependent features found

The PDV project currently has these active Edge Functions:
- `mobflow-login` — username/CNPJ login, subscription validation, first-manager bootstrap.
- `mobflow-users` — list/create/update/toggle/reset/delete PDV users; reset application; delete all PDV users.
- `mobflow-reauth-manager` — manager permission re-authentication using a separate SHA-256 password.
- `mobflow-signup` — company signup, payment proof upload, first-manager setup.
- `mobflow-manager-password-recovery` — manager password recovery using one-time tokens and Gmail SMTP.
- `mobflow-admin-api` — admin integration for listing companies.

The application store still calls the Supabase RPCs `accept_receiving` and `finalize_receiving_decisions`. These must be ported to Neon transactions/API routes before the Supabase database dependency can be removed. The earlier app-state compare-and-swap behavior must remain authoritative.

The payment-proof Storage bucket currently has no objects, but its upload flow still needs a replacement or an explicit decision before removing Supabase Storage. The public billing configuration endpoint is hosted by the separate MobFlow Admin project and must not be modified as part of this PDV migration.

## Implementation sequence

1. Add self-managed Better Auth server and TanStack Start catch-all route on the migration branch only. Use a PostgreSQL connection pool backed by the Neon PG18 test branch. Add the TanStack Start cookie integration.
2. Configure bcrypt-compatible password hashing/verification. Add unit tests using generated bcrypt fixtures; never print or log real hashes.
3. Create a repeatable, idempotent import script for the 7 Auth users and their email identities. Preserve each original UUID and bcrypt hash. Do not import active Supabase sessions or refresh tokens; users will sign in again.
4. Import the application tables into the PG18 test branch, preserving IDs and verifying row counts, foreign keys, CNPJ/company ownership, and subscription states. Keep the source untouched.
5. Change the preview login to use the existing username/CNPJ experience backed by Better Auth and server-side MobFlow validation.
6. Change `mobflow-auth.ts` to validate Better Auth sessions/cookies and continue setting the database tenant context under the restricted `mobflow_api` role.
7. Port `accept_receiving` and `finalize_receiving_decisions` into Neon transactions/API routes, then point the store to those routes.
8. Port user management, manager re-authentication, signup/first-manager setup, and manager password recovery to server routes. Preserve the separate MobFlow Admin integration and payment configuration contract.
9. Test login for existing users, manager/PDV authorization, CNPJ mismatch, suspended/expired subscriptions, password recovery, user provisioning, receiving/stock release, concurrent state writes, two-device refresh, offline retries, and tenant isolation.
10. Only after the Preview tests pass, prepare a cutover plan. Do not change production environment variables, merge to `main`, or delete Supabase data without explicit approval.

## Current state and safety

- Work remains confined to GitHub branch `migration/neon-preparation` and Neon test project `mobflow-pdv-realtime-test`.
- The Supabase project is read-only during this audit; no production records were changed.
- The Vercel Preview still has the previous Supabase-auth bridge configuration. Do not set `MOBFLOW_AUTH_PROVIDER=neon` or switch the database connection yet.
- The existing Neon Managed Auth configuration remains enabled but unused by the new proposed self-managed path.
- No production cutover, account password reset, billing upgrade, or Supabase cleanup has occurred.

## References

- Better Auth Supabase migration guide: https://better-auth.com/docs/guides/supabase-migration-guide
- Better Auth password hashing/security: https://better-auth.com/docs/reference/security
- Better Auth TanStack Start integration: https://better-auth.com/docs/integrations/tanstack
- Neon Auth migration guidance: https://neon.com/docs/auth/migrate/from-supabase.md
- Supabase HTTP 402 service restriction and Egress guidance: https://supabase.com/kb/troubleshooting/http-status-codes
