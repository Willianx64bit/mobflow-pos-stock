# 51 — Incremental sync database validation

Date: 2026-11-07
Repository: `Willianx64bit/mobflow-pos-stock`
Git branch: `migration/neon-preparation`
Neon project: `mobflow-pdv-realtime-test` (`proud-star-34734307`)
Neon validation branch: `incremental-sync-schema-validation` (`br-lingering-credit-bdova1jb`)
Database: `mobflow_pdv_test`
Scope: isolated PostgreSQL 18 validation only.

## Schema state confirmed

Read-only inspection of the validation branch confirmed:

- PostgreSQL 18.6.
- Both `mobflow_sync_events` and `mobflow_sync_counters` exist.
- Three RLS policies exist for the sync tables.
- `mobflow_append_sync_event` exists with the expected tenant/user context contract.
- `mobflow_api` and `mobflow_api_test` are non-superuser roles and do not have BYPASSRLS.
- The branch contains synthetic profiles/state fixtures used by earlier isolation checks; it contains no production records.
- Before and after the tests below, the sync event and counter tables were empty.

## Transactional idempotency test

Executed a temporary PL/pgSQL test block as the restricted `mobflow_api` role:

1. Inserted one synthetic manager profile inside a rollback-only subtransaction.
2. Set `app.user_id`, `app.account_id`, and `app.role` transaction-locally.
3. Called `mobflow_append_sync_event` twice with the same tenant-scoped idempotency key and different event IDs.
4. Asserted both calls returned the same sequence and exactly one matching event row existed.
5. Deliberately rolled back the test subtransaction.

The SQL statement completed without an assertion error. A separate read-only verification confirmed that the temporary profile, event, and counter rows were all absent afterward.

## Tenant-isolation test

Executed a second rollback-only PL/pgSQL test block using the two synthetic tenant managers already present in the branch:

1. Appended a test event under Tenant A's authenticated transaction context.
2. Switched the transaction-local identity context to Tenant B.
3. Asserted Tenant B could not SELECT Tenant A's event.
4. Attempted a direct forged INSERT assigning Tenant A as tenant while using Tenant B as actor; asserted RLS rejected it.
5. Deliberately rolled back all test writes.

The SQL statement completed without an assertion error. A separate read-only verification confirmed that no event rows remained.

## What this proves

The database-level event append path currently enforces:

- per-tenant sequence allocation;
- idempotency for repeated append requests;
- actor/tenant consistency on insert;
- tenant-scoped event reads through RLS;
- no dependence on superuser or BYPASSRLS privileges for the tested API role.

## What this does not prove

- It does not validate the authenticated HTTP event-pull endpoint end-to-end.
- It does not implement or validate client-side event application, durable local event queues, event push, or cursor persistence.
- It does not prove two-device behavior, offline retry, or production readiness.
- It does not authorize enabling Neon Auth flags, copying production credentials/data, or cutting over production.

## Branch and production boundaries

- All SQL tests ran on the isolated Neon validation branch and rolled back their temporary writes.
- No Supabase production DDL/DML, export, import, Auth configuration, or Storage operation was performed.
- No Vercel Production environment variable or deployment was changed.
- MobFlow Admin and ColetaFlow remain out of scope.

## Next implementation gate

Before enabling event-driven client synchronization, implement and test a durable per-device cursor and event-application layer, with explicit handling for unknown event types, replay, duplicate delivery, interrupted batches, and snapshot reconciliation. Keep the existing authenticated snapshot/CAS path and 3-second polling fallback until that complete path passes multi-device and offline regression tests.
