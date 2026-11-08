# 55 — Supabase call-site audit: auth, receiving, signup and Admin boundary

Date: 2026-11-08
Branch: `migration/neon-preparation`
Scope: read-only source review and migration documentation. No runtime source code, database, secret, bucket, or deployment changed.

## Confirmed call-site map

### 1. Login and session validation

- `src/components/LoginScreen.tsx` still contains both branches:
  - Better Auth: calls `POST /api/mobflow/login`, then `mobflowAuthClient.signIn.email`.
  - Legacy: uses `supabase.auth.signOut({ scope: "local" })` and invokes Supabase Edge Function `mobflow-login`.
- In legacy PDV mode, the login component also calls `supabase.auth.getSession()` and reads `public.profiles` to resolve the current company's CNPJ/role.
- `src/lib/server/mobflow-auth.ts` validates HttpOnly Better Auth sessions when `MOBFLOW_AUTH_PROVIDER=better-auth`; legacy mode validates Supabase bearer tokens against `/auth/v1/user`.
- `src/routes/api/auth/$` delegates Better Auth endpoints to the Better Auth server.
- `src/routes/api/mobflow/manager-password-recovery.ts`, `reauth-manager.ts`, and `users.ts` explicitly return 503 unless the server auth provider is Better Auth. Their Better Auth implementations use Neon.
- `src/lib/auth-client.ts` keeps the browser-side mode controlled by `VITE_MOBFLOW_AUTH_PROVIDER`; it does not automatically follow the server-side `MOBFLOW_AUTH_PROVIDER`. Both Preview variables must remain aligned.

### 2. Receiving operations

- `src/lib/store.ts` calls `/api/mobflow/receiving` for accept/finalize when `VITE_MOBFLOW_AUTH_PROVIDER=better-auth`.
- In legacy mode, it calls Supabase RPCs `accept_receiving` and `finalize_receiving_decisions`.
- The Neon route `src/routes/api/mobflow/receiving.ts` is the Better Auth replacement and applies accepted stock changes transactionally with idempotency.
- Do not remove the legacy RPC calls until the Preview Better Auth route has been tested end-to-end for accepted, returned, extra, repeated, and concurrent receiving decisions.

### 3. Payment proof storage

- `src/routes/api/mobflow/signup.ts` imports `@supabase/supabase-js`, reads `SUPABASE_SERVICE_ROLE_KEY`, and uploads to bucket `mobflow-payment-proofs`.
- It persists the resulting object path in Neon `public.companies.payment_proof_path`.
- It removes the uploaded object if the Neon metadata update fails.
- A safe R2 replacement must preserve this lifecycle and add:
  - MIME allowlist and 5 MB limit;
  - non-public bucket/object access;
  - tenant/request-token-scoped object keys;
  - authorization for Admin review/download;
  - cleanup on metadata-write failure;
  - integration tests for upload, duplicate submission, missing R2 config, and failed DB write.

### 4. MobFlow Admin integration boundary

- `src/components/LoginScreen.tsx` reads public billing settings from the separate Admin project's `mobflow-public-billing` Edge Function at `xsitutjpdshmidzpgxpx.supabase.co`.
- This is not the MobFlow PDV Supabase project. Do not remove or alter it as part of the PDV database detachment.
- Before replacing payment-proof storage, the Admin's proof-review/download path must be located and migrated in a separately scoped change; otherwise the Admin could lose access to proofs submitted by PDV companies.
- MobFlow Admin project and repository remain untouched.

## Migration risks / next actions

1. Keep server and Vite auth provider flags aligned in Preview; mismatched flags could make browser login and server API expect different session types.
2. Test the complete Better Auth login/logout/recovery/user-management lifecycle in Preview, including first manager bootstrap and an imported existing account, before changing the default provider.
3. Complete end-to-end Neon receiving tests before removing Supabase RPC fallback.
4. Locate and document the Admin payment-proof reader before implementing R2. Do not change the Admin project implicitly.
5. Implement R2 behind explicit Preview-only environment configuration, with a fail-closed behavior when not configured; keep Supabase proof storage available until the Admin reader is ready.
6. Keep current 3-second state reconciliation until the durable incremental event pull/apply queue passes two-device offline/reconnect and concurrency tests.
7. Attribute Supabase usage by service and source over a representative period; Realtime health-check log samples alone do not establish the app's remaining Realtime use.

## Safety

No Supabase production data, Auth users, Storage objects, SQL schema, or project settings were changed. No Neon production data or schema was changed. No Vercel Production settings were changed. No MobFlow Admin or ColetaFlow files/projects were changed.
