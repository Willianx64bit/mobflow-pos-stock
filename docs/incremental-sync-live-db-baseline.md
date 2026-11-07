# Incremental sync — verified database baseline

Date: 2026-11-07

## Target confirmation

The Supabase project was resolved through the connected Supabase account's project listing:
- Project name: `mobflow-pos-stock`
- Project ref: `ezkwubdpblqkdfampopa`
- Region: `us-west-2`
- Database engine: PostgreSQL 17.11
- Status at inspection: `ACTIVE_HEALTHY`

Do not confuse this project with `xsitutjpdshmidzpgxpx` (MobFlow Admin).

## Applied migration history

The database migration history ends at:
- `20261027123026 atomic_app_state_compare_and_swap`

The following repository migration is NOT present in the applied history:
- `20261028190000_stock_movement_ledger.sql`

Therefore, do not assume that the stock movement ledger migration in the repository has been applied to this database. Reconcile the source and deployed RPC definitions before relying on it.

## Current public schema observed

Tables returned by the live schema inspection:
- `profiles`
- `app_state`
- `account_allowlist`
- `manager_security`
- `manager_security_by_account`
- `companies`
- `manager_password_recovery_tokens`

All listed public tables had RLS enabled. The current `app_state` account policies use `private.current_account_id()` for INSERT, SELECT, and UPDATE ownership checks.

Live helper definitions:
- `private.current_account_id()` returns the profile's `account_id`, falling back to `auth.uid()`.
- `private.current_account_role()` returns the profile role, falling back to `pdv`.

The live database has no `sync_account_counters`, `sync_events`, or `sync_notifications` tables yet. The Realtime publication currently contains only `public.app_state`.

## Live receiving RPC behavior observed

The deployed functions are:
- `public.accept_receiving(p_receiving_id text)`
- `public.finalize_receiving_decisions(p_receiving_id text, p_decisions jsonb)`

Both are `SECURITY DEFINER`, use an empty search_path, derive the account through `private.current_account_id()`, lock the matching `app_state` row with `FOR UPDATE`, and update the JSONB snapshot in one transaction.

`finalize_receiving_decisions`:
- validates that every line has an `aceitar` or `devolver` decision;
- validates that accepted product IDs exist;
- adds received quantities only for accepted products;
- writes decisions, `decisionCompleted=true`, `status=aceito`, and `stockReleased=true` in the same app_state update.

This confirms that a trigger on `app_state` can observe the resulting stock and receiving changes atomically, but event classification must preserve the accepted-only behavior. Do not generate stock deltas for returned lines, and do not emit a second stock event on retry when the RPC returns false after stockReleased is already true.

## Safety decisions

- Do not apply the foundation migration until the policy/function grants and account isolation have been reviewed against the live database.
- Do not publish `sync_events` to Realtime. Only minimal wake-up notifications belong in the publication.
- Do not grant client INSERT/UPDATE/DELETE on event or counter tables.
- Do not add event-writing behavior to client code; event creation must be trusted and atomic with the authoritative state update.
- Do not remove the existing polling or full-state reconciliation until incremental recovery is proven across offline/reconnect and concurrent multi-device tests.
- Do not treat repository migrations as deployed migrations.

## Remaining validation

1. Inspect the exact deployed grants/ownership and function ACLs for the private helpers and receiving RPCs.
2. Inspect the full deployed `app_state` CAS/RLS behavior and the stock ledger migration mismatch.
3. Finalize event schema and sequence allocation, including multi-event transactions.
4. Add trigger/function implementation and SQL regression tests on the feature branch only.
5. Validate account isolation, atomic rollback, ordering, idempotency, receiving accepted/returned quantities, and stock+manual dual-channel notifications.
6. Implement a feature-flagged client reader and manual sidebar sync.
7. Test at least two independent devices and offline recovery before removing polling.
