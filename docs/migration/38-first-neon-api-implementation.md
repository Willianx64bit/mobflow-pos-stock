# 38 — First Neon API implementation

Date: 2026-11-06  
Branch: `migration/neon-preparation`

## Implemented

- Added pinned dependency `@neondatabase/serverless@1.2.0`.
- Regenerated `bun.lock` with Bun 1.3.14 in a one-time GitHub Actions workflow; the workflow was removed after the lockfile commit.
- Added a server-only Neon Pool using `NEON_DATABASE_URL`, max pool size 3.
- Added Supabase Auth token verification through `GET /auth/v1/user`; JWT contents are not trusted without server verification.
- Added transaction-local identity context:
  1. Begin transaction.
  2. Set `app.user_id` transaction-locally.
  3. Read the user's Neon profile under the self-profile RLS policy.
  4. Reject missing/inactive/unsupported profiles.
  5. Set `app.account_id` and `app.role` transaction-locally.
- Added `GET /api/mobflow/session-context`.
- Added `GET /api/mobflow/state`.
- Added `PUT /api/mobflow/state` with insert-if-absent and timestamp compare-and-swap update. Conflicts return HTTP 409 with the remote state/version. Server/database time generates the new version.
- Added request validation and an 8 MiB state payload ceiling.

## Preview build

- Vercel Preview for commit `906b9aaa7963bce3700abe0f0b6c066a32f883ae`: READY.
- This confirms dependency installation and compilation of the API source on the isolated branch.
- The later documentation/workflow-cleanup commit is also building separately.

## Not yet verified

- Protected Preview API requests could not be exercised through the available fetch path because Vercel Deployment Protection blocked the request.
- No valid/invalid-token, CAS, or tenant-isolation HTTP integration suite has been run yet.
- The Neon test branch still has zero profiles and zero app_state rows. Therefore the recovered Supabase account `teste.mobflow` will receive `profile_not_migrated` until its approved profile/state migration is performed.
- No browser store cutover has been made.

## Protected boundaries

No changes to `src/lib/store.ts`, `src/lib/supabase.ts`, Realtime, polling, stock/receiving RPCs, Supabase Auth configuration, Production environment variables, production database, MobFlow Admin, or ColetaFlow.
