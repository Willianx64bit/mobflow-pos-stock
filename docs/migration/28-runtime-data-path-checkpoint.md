# Stage 4 — runtime and data-path checkpoint

Date: 2026-11-06
Scope: read-only inspection of `main`, Vercel project metadata, and the isolated Neon test branch.

## Verified application runtime

- Vercel project: `mobflow-pos-stock`.
- Framework metadata: `tanstack-start-lovable`.
- Node runtime metadata: `24.x`.
- Production domain: `mobflow-pos-stock.vercel.app`.
- Source `vite.config.ts` uses `@lovable.dev/vite-tanstack-config`; its comments explicitly say the preset includes Nitro with Cloudflare as the default build target.
- `src/server.ts` exports a Fetch-style handler `fetch(request, env, ctx)` and dynamically imports the TanStack Start server entry.
- `src/start.ts` configures request middleware and CSRF protection for server functions.
- `package.json` has `@supabase/supabase-js`, but no direct `pg` or `@neondatabase/serverless` dependency.
- No source, package, Vite/Nitro, Vercel, or environment configuration was changed.

## Existing browser data path (must be preserved until replacement is proven)

- `src/lib/supabase.ts` creates a browser Supabase client with the publishable key and persistent/session browser storage.
- `src/lib/store.ts` calls Supabase Auth `getUser()` in `hydrateStore()`.
- The browser then reads `profiles.account_id` by `profiles.id = user.id`; fallback is `user.id`.
- The browser reads and writes the complete `app_state.state` JSONB snapshot.
- Writes use compare-and-swap on `updated_at`, retry up to three attempts, then schedule delayed retries.
- Concurrent conflicts are reconciled by merging sales, stock movements, cash sessions, cash movements, receiving, adjustments, transfers, and other state collections.
- Supabase Realtime subscribes to UPDATE on `public.app_state`, filtered by `owner_id`; a 3-second polling fallback and focus/online refresh are retained.
- The client-side Realtime filter is not an authorization boundary. The server must derive the tenant from the verified Supabase JWT subject and trusted profile data.

## Required backend design before a first migration

1. Keep Supabase Auth and the current browser session lifecycle unchanged.
2. Introduce a server-only database access path; never expose the Neon connection string or privileged role to the browser.
3. Verify Supabase JWT signature, issuer, audience, expiry, and subject server-side.
4. Resolve tenant/account ID from the verified subject using trusted database records; never accept account_id as authority from request payloads.
5. Preserve the app_state JSONB shape and CAS semantics in the first test implementation.
6. Preserve existing Realtime and polling behavior until a separately tested replacement exists.
7. Enforce active profile, role, and permissions on the server; reject missing/inactive identities rather than silently falling back to a tenant.
8. Confirm the actual Nitro deployment preset and Vercel server runtime before choosing a Node Postgres driver or a serverless HTTP driver. The current Vite preset's Cloudflare default and Vercel's Node 24 metadata are not, by themselves, proof of the deployed runtime adapter.
9. No database schema migration should be generated/applied until the identity bridge, server runtime, function contracts, grants, and exact live schema are reconciled.

## Current Neon test baseline

- Project: `mobflow-pdv-test` (`square-haze-51319178`).
- Branch: `integration-test` (`br-wandering-union-bd6vcsk6`), state ready.
- Database: `mobflow_pdv_test`.
- Read-only check on 2026-11-06: `public` contains zero application base tables.
- Read-only function inventory found no application functions in non-system schemas.
- Neon Realtime remains disabled; do not enable it in this phase.

## Safety boundary

This checkpoint is documentation only. No DDL/DML, no data export/import, no credentials or environment changes, no source-code changes, no deployment, no production branch changes, and no changes to Supabase Auth, Realtime, Storage, or production data. The existing `migration/neon-preparation` branch remains isolated; do not merge it wholesale into `main`.
