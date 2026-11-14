# Stage 4 — initial schema migration test report

Date: 2026-11-06
Migration: neon/migrations/0001_initial_schema.sql
Test project: mobflow-pdv-test
Parent branch: integration-test (br-wandering-union-bd6vcsk6)
Temporary test branch: mcp-migration-2026-11-06T20-05-48 (br-fancy-tooth-bdornfch)

## 1. Migration execution

The initial schema SQL was executed successfully by the isolated migration workflow on a temporary child branch. The first attempt was rejected by PostgreSQL due to a trailing comma in the final companies constraint; the SQL file was corrected and the migration was then applied successfully on the temporary branch.

The temporary migration contains schema only. No production rows, credentials, hashes, or customer data were copied.

## 2. Structural verification

Read-only checks on the temporary branch returned:

- 7 public application tables.
- 18 public indexes.
- 24 constraints.
- 4 RLS policies.
- RLS enabled on all 7 tables.
- FORCE RLS disabled on all 7 tables, matching the production posture.

The 24 constraints are one fewer than production because the external profiles.id -> auth.users(id) FK is intentionally removed. The five tenant/user references that previously targeted auth.users now reference the stable profiles identity rows. This model requires server-side Supabase Auth verification on every protected request.

The 18 indexes and 4 policies match the catalog inventory, including the expression/partial indexes and the production policy scope for profiles/app_state.

## 3. Synthetic tenant isolation tests

Only synthetic IDs and usernames were inserted into the temporary branch:

- Tenant A: one manager and one PDV user.
- Tenant B: one manager and one PDV user.
- One app_state row per tenant.

Results using the non-superuser, non-BYPASSRLS test role mobflow_api_test:

- PDV A saw only its own profile.
- PDV A saw only Tenant A's app_state.
- PDV A's attempt to update Tenant B's app_state returned zero rows.
- Tenant A manager saw only the two Tenant A profiles.
- Tenant A manager saw only Tenant A's app_state.
- With no transaction-local identity context, the test role saw zero profiles and zero app_state rows.
- The test role saw zero companies rows because no application policy has yet been granted for that table.
- The role has LOGIN but is not superuser, cannot create roles/databases, and does not have BYPASSRLS.

## 4. Concurrent CAS test

Two transactions ran concurrently using the same expected updated_at value and the same tenant identity context. Both attempted an update of Tenant A's app_state row.

Result:
- Exactly one transaction updated the row and returned the new timestamp.
- The other transaction returned no row, representing a CAS conflict.
- The committed writer value remained singular; no lost update occurred.

This validates the SQL predicate/locking behavior for the initial CAS pattern on the temporary branch. The application-level response shape and retry/merge loop still need implementation and tests in the server API.

## 5. Parent and production safety checks

- The parent Neon branch integration-test still has zero public application tables.
- The temporary branch contains all schema and synthetic fixtures; these are not present in the parent.
- The Supabase production database was queried read-only only.
- No production data was exported/imported.
- No source application code, package dependency, environment variable, Supabase Auth, Realtime, Storage, or Vercel production configuration was changed.
- The GitHub migration branch contains documentation and the SQL migration only; it has not been merged into main.

## 6. Remaining limitations before using this as the parent test schema

1. The server-side Supabase token verification and profile lookup are not implemented.
2. The mobflow_api_test role exists only on the temporary branch. A separate least-privilege role must be created on the parent branch after approval.
3. Only profiles and app_state have RLS policies for the first server slice. Other tables remain RLS-enabled with no policies and are intentionally unavailable to the app role until their server operations and policies are designed.
4. Auth deletion no longer cascades automatically from Supabase Auth to Neon; a server-side deactivation/deletion reconciliation workflow remains required.
5. Receiving RPCs, stock ledger, admin endpoints, recovery flows, and Storage have not been migrated.
6. The app_state CAS server endpoint must preserve the current JSON response contract and merge/retry behavior.

## 7. Decision gate

The temporary branch has completed the initial schema, tenant-isolation, and concurrent-CAS SQL checks. The migration workflow is waiting for an explicit decision:

- Apply the exact tested schema SQL to the parent Neon branch integration-test; the temporary branch will then be deleted.
- Or discard the migration and delete the temporary branch without changing the parent.

No action has been taken on the parent branch.
