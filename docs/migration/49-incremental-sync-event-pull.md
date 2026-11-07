# 49 — Incremental sync: authenticated event pull endpoint

Date: 2026-11-07  
Repository: `Willianx64bit/mobflow-pos-stock`  
Branch: `migration/neon-preparation`  
Commit: `ca7f6ba7389281c587b5e73a452c8bf0b7c379e4`

## What changed

Added `GET /api/mobflow/sync/events` at:

`src/routes/api/mobflow/sync/events.ts`

The endpoint:
- authenticates through the existing `beginAuthenticatedTransaction` flow;
- derives the tenant from `transaction.identity.accountId`, never from a browser-supplied tenant parameter;
- uses the existing transaction-local `app.account_id` and `mobflow_api` role, so RLS remains an independent tenant boundary;
- reads the tenant high-water sequence from `mobflow_sync_counters`;
- returns ordered events after the requested cursor, bounded by that high-water mark;
- caps page size at 250 and defaults to 100;
- returns `nextCursor`, `highWaterMark`, and `hasMore` for pagination;
- releases the authenticated DB transaction on both success and error.

## Request

`GET /api/mobflow/sync/events?cursor=0&limit=100`

The cursor is a non-negative integer sequence. The client must persist its cursor only after applying and saving all events through `nextCursor`.

## Response shape

```json
{
  "ok": true,
  "events": [],
  "cursor": "0",
  "nextCursor": "0",
  "highWaterMark": "0",
  "hasMore": false
}
```

Sequence values are returned as strings to avoid JavaScript integer precision loss in the response.

## Security and limitations

- No account, actor, role, or tenant identifier is accepted from the client.
- The route is read-only; it does not apply events to local storage or advance a client cursor.
- This route does not yet implement push, local durable queue, or event application.
- It does not change the current state snapshot endpoint, polling, stock behavior, receiving behavior, or authentication provider.
- It requires migration 0005 tables to exist in the target Neon database. It is inert until the client calls it.
- It has not yet been built or integration-tested in a Vercel preview. Do not treat the endpoint as production-ready.
- Neon Realtime is not enabled or altered by this commit.

## Next validation

1. Run typecheck/build and route generation on the branch.
2. Exercise no-events, one-page, multi-page, invalid cursor, and limit cap cases.
3. Verify tenant A cannot retrieve tenant B events using separate authenticated test profiles.
4. Verify an event appended after the high-water read is picked up by the next request.
5. Only then implement the authenticated push contract and atomic event append in domain transactions.


## Receiving transaction integration — 2026-11-07

The existing Better Auth Neon receiving route now appends events before committing its existing `app_state` transaction:

- One manual `receiving` event includes the accepted status, decision completion, accepted/returned line counts, and per-line product ID, received quantity, and decision.
- One automatic `stock` event is appended for each product with a positive accepted quantity. Its payload contains only the stock delta and source.
- Returned lines never produce stock events.
- The event payload is size-checked before append (15,000 bytes, below the database's 16 KiB limit).
- Stable deterministic idempotency UUIDs are derived from tenant + receiving ID + release operation + product ID.
- The event inserts and `app_state` update run in the same authenticated PostgreSQL transaction. If any append or state update fails, the transaction rolls back.
- The route rejects accepted quantities referencing a product absent from the current product list.

Files changed:
- `src/routes/api/mobflow/receiving.ts`

Commit:
- `9ad23ab93b7f0966c78bb9dffecb53d9e3931aca`

## Validation status after receiving integration

Not yet build- or integration-tested. No runtime test has exercised accepting a receiving note, returned lines, retries, or rollback against Neon. The existing receiving route is active only when `MOBFLOW_AUTH_PROVIDER=better-auth`; the legacy Supabase RPC path was not changed and does not yet emit these new events. The event-pull route also has not yet been called by the client.

Do not remove polling or change client sync behavior based on this implementation alone.


## Automatic stock and price event integration — 2026-11-07

The existing authenticated `PUT /api/mobflow/state` CAS path now detects stock and price changes for existing products:

- It locks the matching `app_state` version using the caller's expected timestamp.
- It compares previous and incoming product arrays by stable product ID.
- A changed stock value appends an automatic `stock` event containing the delta, resulting stock, and source marker.
- A changed price appends an automatic `price` event containing the new and previous price.
- New products and deleted products are not classified by this comparison; catalog synchronization remains a separate manual-sync task.
- Event append and the existing snapshot update share the same transaction. If event append fails, the snapshot update rolls back.
- A stale CAS request does not append events; it follows the existing conflict response path.
- Product values are not copied into broad company snapshots; each event is a small product-scoped payload.

Files changed:
- `src/routes/api/mobflow/state.ts`

Commit:
- `a2a7f872434bc5d45f92f95008c11f11a076dc8b`

## Current validation status

These code changes have not yet passed a local TypeScript build or live API integration tests. The existing app snapshot/CAS path and 3-second polling remain in place. This implementation is on the migration branch only; it is not deployed to production.
