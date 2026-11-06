# 39 — API compatibility and Preview access review

Date: 2026-11-06
Branch: `migration/neon-preparation`

## Verified

- Preview deployment for commit `5fd1f18e4b4a8881d4501ec8faedfe4edfd42475` is `READY`.
- Follow-up documentation commit `c547a981b495da2f8969b5446ce4d3f1d80cea17` also deployed to Preview with state `READY`.
- Vercel build output includes the Neon serverless driver in the server function bundle.
- The Supabase project URL in `src/lib/server/mobflow-auth.ts` matches the existing client configuration in `src/lib/supabase.ts`; no URL change is required.
- The API source keeps Neon access server-side, verifies bearer tokens with Supabase Auth, derives the profile/account from Neon, and sets identity GUCs transaction-locally.
- State writes use insert-if-absent for first save and timestamp CAS for subsequent saves.

## Test data copied to Neon test branch

Source of truth remains Supabase production; only the isolated Neon branch was written.

- Copied the four `profiles` rows belonging to test account `TESTE.MOBFLOW`, preserving every profile/Auth UUID.
- Copied the company's operational metadata row for the same account. Sensitive payment request/setup tokens, proof paths, and payment notes were not copied; database defaults remain in effect for omitted fields.
- Copied the complete `app_state` JSON snapshot (127,764 bytes) and its original `updated_at` timestamp.
- All inserts used `ON CONFLICT DO NOTHING`; no existing target rows were overwritten.
- Neon verification after copy: 4 profiles, 1 company, 1 app_state.
- Under `mobflow_api_test` RLS context, manager sees 4 account profiles and 1 app_state row; PDV sees only its own profile and 1 account app_state row.
- No source Supabase rows were changed.

## Preview HTTP validation blocker

- The deployment is protected by Vercel Deployment Protection.
- The available Vercel fetch flow returns `401 deployment_authentication_required` after its share-link redirect, including when the share URL is supplied.
- Therefore no HTTP response from `/api/mobflow/session-context` or `/api/mobflow/state` is being treated as verified.
- A shareable protection bypass already exists for the deployment; creating another one returned `protection_bypass_conflict`. Do not weaken project-wide or production protection to work around this.

## Compatibility boundary

- `src/lib/store.ts` still uses Supabase directly for hydration, app_state persistence, Realtime, and receiving RPCs.
- The new Neon API is not yet wired into the browser store. This is intentional: the existing store's CAS retry/merge behavior, Realtime refresh behavior, and receiving RPCs must not be disrupted.
- No changes were made to `src/lib/store.ts`, `src/lib/supabase.ts`, Auth/session storage, Realtime/polling, stock/receiving RPCs, production environment variables, production database, MobFlow Admin, or ColetaFlow.

## Next safe steps

1. Validate authenticated and unauthenticated API requests, first save, CAS conflict, and cross-tenant isolation through an authorized Preview test path.
2. Compare the copied test state against source checksums and representative collection counts.
3. Only after HTTP/API tests pass, design the store adapter cutover as a separate reviewed change. Keep Supabase Auth and receiving RPCs unchanged in that first cutover.
