# MobFlow incremental synchronization plan

## Scope and safety

This work is isolated on `feature/incremental-sync`. Production `main`, the current Supabase schema, and the existing 3-second fallback remain unchanged until the replacement has passed multi-device tests.

The current source of truth is still `public.app_state` (one JSONB snapshot per account). Do not remove it or rewrite sales/stock operations as part of the first rollout.

## Synchronization contract

### Immediate channel (Realtime)
Only:
- product stock balance changes;
- product price changes.

Realtime messages must be small invalidation/sequence notifications, not a broadcast of `app_state` or a complete product catalogue. A receiving approval may update stock immediately even though the receipt document, conference, and decisions are part of manual synchronization.

### Manual channel (sidebar button)
Fetch incremental changes only after explicit user action:
- product creation, edits other than price/stock, import, and deletion;
- receiving documents, conference details, discrepancies, decisions, and status;
- promotions;
- users' public profile/role/permission/active state (never passwords, tokens, or auth secrets);
- branches/stores, categories, settings, and other master data.

The receiving RPCs `accept_receiving` and `finalize_receiving_decisions` are special: their transaction must publish a stock delta to the immediate channel and a receiving-domain event to the manual channel.

## Proposed database model

1. `sync_account_counters`: one row per account, with a monotonically increasing `last_sequence`. Increment under row lock in the same transaction as the source mutation.
2. `sync_events`: append-only event payload store, keyed by `(account_id, sequence)`; fields include event id, domain, operation, entity id, minimal JSON payload, actor id, device/idempotency key, and timestamp. This table is not added to the Realtime publication.
3. `sync_notifications`: minimal notification rows keyed by account and sequence, with a channel discriminator (`stock_price` or `manual`). Only this small table is published to Realtime.
4. Client cursor: persist last successfully applied sequence per account/device locally. Acknowledgement advances only after the whole batch is applied and persisted locally.

## Event generation and atomicity

Event creation must be in the same database transaction as the mutation. Prefer database triggers on `app_state` updates for legacy JSONB-backed writes, with domain-aware diffs:
- compare products by stable product id;
- emit only changed `stock` and `price` fields on the immediate channel;
- emit product create/update/delete and all other changed domain records to the manual channel;
- do not place complete `app_state` snapshots in either event table.

RPCs that update `app_state` (especially receiving) must pass through the same trigger or call the same internal event writer. Verify every RPC's security mode and effective RLS context before rollout.

The trigger must suppress no-op updates and avoid generating duplicate events for a mutation. Sequence allocation and event insert must roll back if the source update rolls back.

## Tenant isolation and authorization

- Derive account id on the server from the authenticated user's profile/account mapping; never trust a client-supplied account id.
- Apply RLS to event reads and notifications using the same account boundary as `app_state`.
- Do not expose auth credentials or private user data in event payloads.
- Restrict event writes to trusted database functions/triggers; clients receive read-only access.
- Check account ownership and role before any administrative event is exposed.

## Client behavior

- Realtime notification marks either the immediate delta channel or manual sync button as pending.
- Immediate stock/price events are fetched and applied as minimal patches; they do not trigger a full hydration.
- Manual events are fetched only when the user presses the sidebar button.
- The button shows idle, pending (yellow), syncing, complete, or retry/error states and the last successful sync.
- On reconnect/focus, request only the latest sequence/head metadata and compare it with the local cursor. Do not download the event payload until the user requests manual sync.
- Fetch bounded batches in sequence order. Advance cursor only after successful application. Use event ids/idempotency keys to make replay safe.
- If a cursor is older than retained event history, use an explicit one-time baseline snapshot/reconciliation path and then resume deltas. Never silently skip a gap.

## Migration and rollout order

1. Audit all mutation paths and database RPC definitions.
2. Add event tables, indexes, RLS, internal event writer, and notification publication on the feature branch only.
3. Add automated SQL tests for tenant isolation, rollback atomicity, ordering, idempotency, and receiving stock release.
4. Add client delta reader and local patch application behind a feature flag; keep legacy Realtime and polling active.
5. Test two or more devices: concurrent sales, price changes, receiving approval, manual product changes, offline edits, reconnect, replay, and user permission changes.
6. Compare event cursor with local state and verify no missed or duplicate stock movements.
7. Only after successful tests, switch traffic to the new flow and remove full-snapshot polling. Keep a rollback path.

## Explicit non-goals

- No migration from Supabase to Neon in this work.
- No changes to ColetaFlow.
- No changes to MobFlow Admin unless a specific shared authorization dependency requires it.
- No removal of `app_state` in the first rollout.
- No production database migration or production polling removal during the design/audit phase.
