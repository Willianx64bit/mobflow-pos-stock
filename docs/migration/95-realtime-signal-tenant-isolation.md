# 95 — Neon Realtime signal table and tenant isolation

Date: 2026-11-12  
Repository: `Willianx64bit/mobflow-pos-stock`  
Branch: `migration/neon-preparation`  
Target: Preview Neon branch `br-red-tree-bdk94c7k`, database `mobflow_pdv_clean_start`

## Root cause

Neon Realtime rejected the sealed live query with `unsupported query: row security`. The query was reading `mobflow_sync_counters`, which correctly has RLS enabled. Realtime's query engine currently does not support RLS-protected tables.

## Change

Additive migration: `neon/migrations/0006_realtime_signal_without_rls.sql`.

- Keep RLS enabled on `mobflow_sync_counters` and `mobflow_sync_events`.
- Add `mobflow_realtime_signals` with exactly two columns: `tenant_id` and `last_sequence`.
- Disable RLS only on this minimal notification table.
- Grant the server database role the minimum table privileges required for the append function and sealed read query; revoke PUBLIC privileges.
- Backfill each signal from the existing tenant counter.
- Update the signal in `mobflow_append_sync_event` in the same PostgreSQL transaction as the counter and durable event.
- Keep idempotent retries idempotent; a retry repairs/advances the signal without inserting a second event.
- The backend obtains `accountId` from the authenticated session and seals a parameterized query filtered by `tenant_id = $1`. The browser cannot choose a tenant ID, submit SQL, or receive the Realtime secret or database credentials.

The signal table contains no event payload, product data, user data, or company details. It is only a wake-up/high-water-mark notification. Durable event reads continue through the authenticated API and the RLS-protected event table.

## Preview database validation

Applied only to branch `br-red-tree-bdk94c7k`, database `mobflow_pdv_clean_start`.

Verified catalog state:

| Table | RLS | Columns |
|---|---|---|
| `mobflow_realtime_signals` | disabled | `tenant_id, last_sequence` |
| `mobflow_sync_counters` | enabled | existing columns unchanged |
| `mobflow_sync_events` | enabled | existing columns unchanged |

Two distinct tenant contexts were exercised as `mobflow_api` inside savepoints:

- Tenant A appended a test event and its signal reached sequence 1; RLS returned zero rows for Tenant B's counter and event ledger.
- Tenant B appended a test event and its signal reached its own existing high-water mark (74); RLS returned zero rows for Tenant A's counter and event ledger.
- Both savepoints were rolled back, so test events/counter changes were not retained.

## Automated application checks

`src/test/mobflow-realtime-live-query.test.ts` verifies that the backend seals the minimal signal query with the authenticated tenant parameter for two different tenant identities, and does not include the event table in the Realtime query.

## Not yet claimed

The database schema and transactional signal path are validated. Full browser WebSocket delivery and a two-company authenticated end-to-end Realtime test still need to pass in the Preview deployment before this is considered complete. Production, the Admin repository, and ColetaFlow were not changed.
