# 48 — Incremental sync foundation: schema and safety contract

Date: 2026-11-07  
Repository: `Willianx64bit/mobflow-pos-stock`  
Branch: `migration/neon-preparation`  
Target database: isolated Neon test branch `realtime-validation`  
Status: design and migration draft committed to the branch; **SQL not applied**.

## Scope and safety

- MobFlow PDV only.
- No MobFlow Admin or ColetaFlow changes.
- No production branch, deployment, or database changes.
- Existing `app_state` JSONB, CAS, local persistence, polling, stock merge, and receiving flow remain untouched.
- Existing Supabase auth/session path remains available; no provider cutover.

## Verified identity model

The current schema uses two distinct identifiers:

- `profiles.id`: individual profile UUID. The manager/root profile is also the account root.
- `profiles.account_id`: tenant/root profile UUID shared by the manager and its PDV users.
- `app_state.owner_id`: FK to `profiles.id`; the API currently queries it using the authenticated identity's `accountId`, which resolves to the manager/root profile ID.

Every sync event therefore stores both:
- `tenant_id`: account root/profile UUID, used for tenant partitioning and sequence scope.
- `actor_profile_id`: the authenticated individual profile UUID.

The API must continue deriving both from the verified server-side session. The browser must not choose either identifier.

## Current state API and receiving route findings

- `GET/PUT /api/mobflow/state` authenticates, uses `mobflow_api`, and runs CAS writes on `app_state`.
- The state endpoint uses the account root UUID as `app_state.owner_id`.
- The Neon receiving route locks the `app_state` row, validates the receiving note/decisions, applies accepted quantities to products, and updates the receiving status in one transaction.
- The receiving route currently does **not** append a separate durable sync event. That is a required integration point.
- The current receiving code should not be changed until the event append is included in the same transaction as the state update.

## Proposed event model

Migration draft: `neon/migrations/0005_incremental_sync_foundation.sql`.

### `mobflow_sync_counters`

One counter row per tenant, used to allocate a monotonic sequence under a row lock.

### `mobflow_sync_events`

Append-only event ledger with:
- globally unique `event_id`;
- `tenant_id` and per-tenant `sequence`;
- per-tenant `idempotency_key`;
- authenticated `actor_profile_id`;
- category and delivery mode;
- entity type and ID;
- bounded JSON object payload;
- creation timestamp.

Unique keys protect event ID, tenant sequence, and tenant idempotency key. Payloads are intentionally small; passwords, auth/session tokens, hashes, billing secrets, and complete company snapshots must never be placed in events.

### Atomic append

`mobflow_append_sync_event` is SECURITY INVOKER and expects the caller's existing authenticated transaction context (`app.account_id`, `app.user_id`). It locks the tenant counter, checks the idempotency key, allocates a sequence, and inserts the event. The function does not open or commit a transaction; callers must append the event before committing the domain mutation.

## Delivery classification

- Automatic: stock balance deltas and price changes.
- Manual: catalog/product metadata, receiving documents and conference details, decisions/status, promotions, user public profiles/permissions/active state, settings, branches/stores, categories, and other master data.
- A receiving acceptance/finalization must append its manual receiving event and automatic stock event(s) in the **same transaction** as the accepted stock update.
- Returned items must never generate stock increases.
- Replaying the same operation must return the existing sequence and must not apply stock twice.

## Tenant authorization

- Both tables enable RLS.
- Policies scope reads/writes to the server-derived `app.account_id`.
- Event inserts additionally require `actor_profile_id = app.user_id` and an active profile belonging to that tenant.
- `mobflow_api` remains non-owner and `NOBYPASSRLS`.
- No direct browser access, public grants, or Realtime direct-table subscription is authorized by this draft.

## Important implementation constraints

1. All domain mutation + event append must share one PostgreSQL transaction.
2. Do not rely on the event stream as the source of truth for stock; current domain state and ledger remain authoritative.
3. Event payloads must be minimized and validated by server code.
4. Manual sync requires bidirectional push/pull and cursor recovery; a pull-only endpoint is insufficient.
5. Client cursor advances only after events are applied/persisted locally.
6. Cursor gaps, duplicated events, reconnects, and stale notifications trigger a durable pull from the last confirmed cursor.
7. Polling remains until the complete replacement passes multi-device, offline, permission-revocation, and tenant-isolation tests.
8. Neon Realtime beta has no RLS according to the previously reviewed Neon documentation. Do not expose raw event tables directly through an untrusted client subscription. Use backend-authorized sealed queries only after validating current SDK capabilities and revocation behavior; otherwise keep the authenticated API pull path.

## Remaining before applying migration 0005

- Reconfirm exact `profiles` self/root relationship and all active/inactive account cases.
- Validate migration against a disposable Neon branch cloned from the test branch.
- Test RLS as `mobflow_api` for two tenants and multiple users.
- Test function grants, idempotent retries, concurrent appends, and rollback behavior.
- Integrate the function into state and receiving transactions with strict event payload schemas.
- Add API endpoints for automatic event notification and manual bidirectional sync.
- Add client-side durable queue/cursor only after the API contract is stable.

No migration has been applied to Neon in this step.


## Disposable-branch validation — 2026-11-07

The draft migration was executed on a separate Neon validation branch cloned from the existing test branch:
- Project: `mobflow-pdv-realtime-test`
- Validation branch ID: `br-lingering-credit-bdova1jb`
- Parent test branch: `br-wild-night-bds1bdfk`

Checks performed successfully:
1. All 18 migration statements completed in one transaction.
2. `mobflow_append_sync_event` inserted an automatic stock event with sequence `1`.
3. Repeating the same tenant idempotency key returned sequence `1`, not a second event.
4. The same transaction saw exactly one event after the retry.
5. Under `mobflow_api`, a tenant-A context saw zero rows and zero counter rows for tenant B.
6. The test transaction was rolled back, so the inserted test event/counter did not remain as test data.

Limitations:
- This validates schema creation, the append function, basic idempotency, and RLS tenant filtering.
- It does not yet validate concurrent writers, actor mismatch rejection, event retention, API payload validation, offline queue semantics, or Realtime delivery.
- The disposable validation branch was retained after testing; it was not deleted.
- The migration remains **unapplied** on the primary test branch `br-wild-night-bds1bdfk` and production.
