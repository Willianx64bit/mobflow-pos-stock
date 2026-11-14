# 93 — Relational bootstrap, legacy backfill and sync policy

Status: implemented and exercised on the isolated Neon test branch; not enabled for Preview cutover.

## Scope and safety

- Target database: `mobflow_pdv_test` on the isolated Neon validation branch.
- Migration branch: `migration/neon-preparation`.
- `app_state` is retained as the source snapshot and fallback. No rows are deleted or rewritten by the backfill.
- The operational schema is additive: products/barcodes, sales/items/payments, cash sessions/movements, stock ledger and promotions.
- A per-tenant backfill marker stores the source timestamp and MD5 snapshot hash. A tenant is imported atomically; a rerun with the same hash skips it. A changed source hash or pre-existing relational rows without a marker stops the migration for explicit reconciliation.
- Historical stock ledger rows are marked `legacy_reconstructed`, not represented as verified live ledger entries. Their original IDs, dates, balances, deltas and snapshots are preserved.
- The backfill does not manufacture historical sync events. The bootstrap reads the current relational snapshot and its event high-water cursor in the same SQL statement.

## Migrations

1. `0006_operational_relational_foundation_DRAFT.sql`: relational catalog, sales/payments, cash and stock ledger tables with tenant-scoped RLS and grants.
2. `0007_incremental_sales_cash_event_compatibility_DRAFT.sql`: expands event categories to sales/cash and payload limit to 128 KiB.
3. `0008_app_state_relational_backfill_DRAFT.sql`: adds the promotions table, backfill marker table, preflight checks and idempotent data import from `app_state`.

These remain draft-named repository migrations until the isolated test and review process is complete. The schema and backfill were exercised on the isolated test database only; no production branch was changed.

## Relational bootstrap API

`GET /api/mobflow/state` now has a relational projection for:
- products and barcodes;
- sales and sale items/payment snapshots;
- cash sessions and movements;
- stock movement ledger;
- promotions.

All other state domains remain in the `app_state` snapshot. The relational projection is guarded by server-only `MOBFLOW_RELATIONAL_BOOTSTRAP_ENABLED=true`; default is off. This prevents the new reader from becoming authoritative before every legacy writer is reconciled. When enabled, the state snapshot and event cursor are read atomically in one SQL statement.

The local normalizer avoids reconstructing a second legacy stock movement when the relational bootstrap already supplied a movement for the same operation/product.

## Sync policy

| Data | Delivery |
| --- | --- |
| Product stock balance | Automatic / realtime event |
| Regular product price and catalog changes | Manual |
| Promotion upsert/delete | Automatic / realtime event |
| Sale detail/history | Manual event; its stock-balance effects are automatic |
| Cash history and movements | Manual event |
| Catalog descriptions, barcodes and other bulk catalog fields | Manual |
| Users, permissions and company setup | Manual |
| Logos, product photos, Pix proofs and documents | Manual upload/download through private R2 |
| Conferences, receiving, long histories and bulky workflow records | Manual |

The stock command emits an automatic per-product balance event and a separate manual stock-operation history event. Promotion events carry only the compact promotion projection. Promotion upsert/delete events are applied idempotently by the incremental event projector.

## Test-branch observations

The test branch contained four app_state tenant snapshots:
- Two fixture tenants with only a tenant marker and zero operational records.
- One test tenant with 1 product, 1 sale, 1 sale item, 1 cash session and 2 stock movements.
- One test tenant with 1 product and 1 stock movement.

Backfill results matched those source counts. Current stock balances copied from the snapshot were 999 and 250 respectively. Historical stock movements were labeled `legacy_reconstructed`. Re-running the migration completed successfully without duplicating rows. Tenant isolation was verified under `SET LOCAL ROLE mobflow_api` with transaction-local account context: each test tenant could see only its own product rows. The relational GET query was executed directly against Neon with the bootstrap gate both true and false; the enabled query returned the relational product/sale/cash/ledger projection and cursor from the same statement, while the disabled query returned the legacy snapshot.

## Rollback preparation

The outbox now stops sending later commands after a permanent business rejection and blocks automatic queue progress while a failed command remains. This protects command ordering, but it is not the optimistic rollback itself: the failed command's local effects still need to be reversed by command ID, and later pending operations need to be replayed safely.

## Still required before enabling the mode

- Implement and test command-ID rollback/replay for sales, cash and stock, including dependencies between opening a cash session, movements and sales.
- Complete dual-write / cutover rules for every remaining legacy writer so snapshot saves cannot overwrite authoritative relational stock or leave sales/cash stale.
- Add real API integration tests using the runtime role and tenant context, including two devices, offline retries and app restart.
- Keep `MOBFLOW_RELATIONAL_BOOTSTRAP_ENABLED`, `VITE_MOBFLOW_INCREMENTAL_SYNC` and `VITE_MOBFLOW_INCREMENTAL_BOOTSTRAP_READY` off until those checks pass.
- Do not remove `app_state` or disable Supabase during this stage.
