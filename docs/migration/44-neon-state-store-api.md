# 44 — MobFlow state store routed through Neon API

## Scope

This change applies only to the preview branch `migration/neon-preparation`. It does not change production, the MobFlow Admin project, or ColetaFlow.

## What changed

- `src/lib/store.ts` now reads the company state through `GET /api/mobflow/session-context` and `GET /api/mobflow/state`.
- Writes now go through `PUT /api/mobflow/state`; the browser no longer queries or updates Supabase `app_state` directly.
- The API receives the current Supabase access token as a temporary authentication bridge. Supabase Auth remains the active login provider until the Neon Auth frontend migration is completed.
- Compare-and-swap writes preserve the `expectedUpdatedAt` version check. HTTP 409 responses merge the remote snapshot and retry, preserving the existing stock movement reconciliation logic.
- Local storage remains available when the API is unavailable. Failed writes remain queued for retry.
- Supabase Realtime subscription was removed from this store path. A 3-second polling fallback calls the Neon API while the app is active; focus, visibility, and online events also trigger a refresh. Native Neon Realtime client integration remains a later stage.

## Important limitations

- This is a preview-only code change. It does not move production data or change Vercel environment variables.
- The current Supabase Auth gateway was previously observed returning HTTP 402 because of Egress Exceeded. Since the temporary bridge still validates the Supabase token through Supabase Auth, the Neon state API cannot authenticate users while that gateway remains blocked.
- Neon Auth is not yet connected to the frontend. Do not set `MOBFLOW_AUTH_PROVIDER=neon` yet.
- No live user/company data was migrated or modified by this code change.
- Build and automated test results must be checked from the new preview/CI run before calling this stage validated.

## Next validation

1. Confirm Vercel Preview build succeeds for the new commit.
2. Run unit tests and type checking.
3. Once Supabase Auth is reachable or the Neon Auth frontend is ready, test session context, initial state load, save, 409 concurrent update, two-device refresh, and offline retry against the PG18 test branch.
4. Integrate Neon Realtime separately after API persistence is stable.
