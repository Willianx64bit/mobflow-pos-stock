# 50 — Incremental sync: product catalog events

Date: 2026-11-07  
Repository: `Willianx64bit/mobflow-pos-stock`  
Branch: `migration/neon-preparation`

## Scope

The authenticated state compare-and-swap endpoint now emits manual `catalog` events in the same transaction as its `app_state` update.

- New products: `operation: upsert` with the supported catalog fields.
- Changed catalog metadata: `operation: upsert` with the current supported catalog projection.
- Deleted products: `operation: delete`.
- Stock and sale price remain separate automatic events.
- Photos are deliberately excluded; they will be migrated to object storage and synchronized by reference later.
- The event actor and tenant are still derived by the database transaction context, not from request fields.

Catalog projection currently includes `code`, `barcodes`, `ref`, `name`, `cost`, `minStock`, `category`, and `unit`. The projection excludes photo bytes/URLs, stock, and sale price to avoid large payloads and duplicate event semantics.

## Atomicity

Events are appended only after the CAS update succeeds, and remain inside the same authenticated database transaction. A failed event append rolls back the snapshot update. Stale CAS writes do not emit catalog events.

## Validation

Added a unit test for product create/delete event payloads and explicit photo exclusion. The GitHub Actions workflow must pass after this change; this document does not claim runtime multi-device validation.

## Still pending

- Product event application and durable local queue on the client.
- Manual push/pull for promotions, receiving/conference, users/permissions, contacts, suppliers, settings and other master data.
- Tenant-isolation and concurrent append integration tests against the isolated Neon database.
- Runtime verification on two authenticated test devices.
- Keep the 3-second polling fallback until these are proven.
