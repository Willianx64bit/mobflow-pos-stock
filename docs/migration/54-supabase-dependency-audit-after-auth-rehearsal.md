# 54 — Supabase dependency audit after auth rehearsal

Date: 2026-11-08
Branch: `migration/neon-preparation`
Scope: source-code audit only. No runtime code, database, secret, production environment, or deployment changed.

## Confirmed checkpoint

The GitHub Actions dry-run completed successfully against the production Supabase source and the isolated Neon rehearsal target:

- 7 active email users found at source.
- 7 bcrypt-compatible password hashes.
- 7 matching MobFlow profiles.
- 7 email identities; no unsupported identity provider was reported by the script.
- A read-only aggregate comparison confirmed all 7 source auth emails match the synthetic Better Auth email alias generated from each MobFlow username; 0 mismatches. No email addresses were displayed or exported by this check.
- Destination Better Auth tables were empty (0 users, 0 accounts, 0 sessions).
- Result: `mode=dry-run`; no user or password hash was written.

This is not an account migration and does not authorize production cutover.

## Dependency map found in the migration branch

### Authentication

- `src/lib/auth-client.ts` selects Better Auth only when `VITE_MOBFLOW_AUTH_PROVIDER=better-auth`; legacy Supabase login remains available otherwise.
- `src/components/LoginScreen.tsx` validates credentials and MobFlow business rules through `POST /api/mobflow/login`, then creates the Better Auth cookie session through `mobflowAuthClient.signIn.email`.
- `src/routes/api/auth/$.ts` delegates Better Auth requests to the self-managed Better Auth server.
- `src/lib/server/better-auth.ts` uses the Neon database URL and bcryptjs verification, compatible with the imported Supabase bcrypt hashes.
- `src/lib/server/mobflow-auth.ts` retains the Supabase bearer-token validation branch for legacy mode. Better Auth mode validates the HttpOnly session instead.
- `src/lib/supabase.ts` still initializes the Supabase browser client because the legacy mode and several fallback paths remain. Do not remove this package/client until all call sites and production cutover are validated.

### Supabase Storage — payment proofs (not migrated)

- `src/routes/api/mobflow/signup.ts` still uploads payment proof files to bucket `mobflow-payment-proofs` using `SUPABASE_SERVICE_ROLE_KEY`.
- It stores the object path in Neon `companies.payment_proof_path`.
- Failure cleanup also removes the uploaded object from Supabase Storage.
- The bucket was previously inspected and found empty at that time, but the code path is still active. Do not remove it before an R2 implementation has upload, metadata persistence, access control, cleanup, and retrieval tests.

### MobFlow Admin billing dependency (preserve)

- `src/components/LoginScreen.tsx` fetches public billing configuration from the separate MobFlow Admin Supabase project endpoint `mobflow-public-billing`.
- This is a cross-project integration with MobFlow Admin, not the MobFlow PDV database project.
- Do not disable or modify this endpoint as part of the PDV database migration without a separately reviewed replacement and explicit scope. The Admin project is separate and must remain untouched.

### Synchronization

- `src/lib/store.ts` branches API authentication: Better Auth mode uses same-origin HttpOnly cookies; legacy mode gets a Supabase access token.
- The current 3-second reconciliation timer calls `GET /api/mobflow/state`, whose implementation reads Neon through `beginAuthenticatedTransaction`. It is not a direct browser-to-Supabase database poll in Better Auth mode.
- Keep the 3-second timer until durable local pending operations, event pull/apply, cursor advancement, retry/recovery, and multi-device concurrency are tested. Reducing it now could hide missed updates.
- The store still contains legacy Supabase RPC fallback calls for receiving operations. They must be traced and verified against the Better Auth route before the Supabase client can be removed.
- This targeted source review did not establish the source of the remaining Supabase Realtime log activity. A complete repository-wide search and runtime attribution are still required; do not infer that Realtime is unused from this partial audit.

## Work order from this audit

1. Finish route-by-route inventory of Supabase imports, Edge Function calls, Storage calls, auth/session calls, and Realtime subscriptions.
2. Port payment-proof storage to Cloudflare R2 in Preview only, preserving the Neon path metadata and adding authorization/retrieval/cleanup tests.
3. Trace and test all Better Auth versus legacy branches for login, logout, user management, manager re-authentication, recovery, receiving, and state persistence.
4. Attribute Supabase Realtime and request/egress usage using project analytics and runtime logs before removing any subscription or polling.
5. Keep the Neon incremental event system and current polling until durable event synchronization passes multi-device tests.
6. Only after all Preview checks pass, prepare a separately approved production cutover and rollback plan.

## Safety boundary

- No Supabase production DDL/DML, data deletion, storage deletion, or auth import was performed.
- No Neon production database was changed.
- No Vercel Production variables or deployment were changed.
- No MobFlow Admin or ColetaFlow files/projects were changed.
