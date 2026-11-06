# 39 — API compatibility and Preview access review

Date: 2026-11-06
Branch: `migration/neon-preparation`

## Verified

- Preview deployment for commit `5fd1f18e4b4a8881d4501ec8faedfe4edfd42475` is `READY`.
- Vercel build output includes the Neon serverless driver in the server function bundle.
- The Supabase project URL in `src/lib/server/mobflow-auth.ts` matches the existing client configuration in `src/lib/supabase.ts`; no URL change is required.
- Neon test role `mobflow_api_test` can connect and sees zero profiles and zero app_state rows.
- The API source keeps Neon access server-side, verifies bearer tokens with Supabase Auth, derives the profile/account from Neon, and sets identity GUCs transaction-locally.
- State writes use insert-if-absent for first save and timestamp CAS for subsequent saves.

## Preview HTTP validation blocker

- The deployment is protected by Vercel Deployment Protection.
- The available Vercel fetch flow returns `401 deployment_authentication_required` after its share-link redirect, including when the share URL is supplied.
- Therefore no HTTP response from `/api/mobflow/session-context` or `/api/mobflow/state` is being treated as verified.
- A shareable protection bypass already exists for the deployment; creating another one returned `protection_bypass_conflict`. Do not weaken project-wide or production protection to work around this.

## Source-of-truth and migration blocker

- Supabase remains the source of truth.
- The Supabase SQL connector currently rejects its own connection reference with `ref must be exactly 20 characters long`, preventing a fresh read of the test account's exact profile/company/state rows.
- Neon test branch still has zero visible profiles and app_state rows for `mobflow_api_test`.
- Do not create synthetic identity data or copy a partial state snapshot. Preserve Auth UUIDs and exact company/account relationships.

## Compatibility boundary

- `src/lib/store.ts` still uses Supabase directly for hydration, app_state persistence, Realtime, and receiving RPCs.
- The new Neon API is not yet wired into the browser store. This is intentional: the existing store's CAS retry/merge behavior, Realtime refresh behavior, and receiving RPCs must not be disrupted.
- No changes were made to `src/lib/store.ts`, `src/lib/supabase.ts`, Auth/session storage, Realtime/polling, stock/receiving RPCs, production environment variables, production database, MobFlow Admin, or ColetaFlow.

## Next safe steps

1. Restore a supported way to read the Supabase test account without exposing credentials.
2. Migrate only the approved test profile/company metadata and app_state into the Neon test branch, preserving UUIDs.
3. Validate authenticated and unauthenticated API requests, first save, CAS conflict, and cross-tenant isolation through an authorized Preview test path.
4. Only after those pass, design the store adapter cutover as a separate reviewed change. Keep Supabase Auth and receiving RPCs unchanged in that first cutover.
