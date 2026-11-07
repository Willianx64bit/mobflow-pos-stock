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
