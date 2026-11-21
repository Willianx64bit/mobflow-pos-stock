# Stage 4 — parent branch least-privilege role and repeat verification

Date: 2026-11-06
Branch: integration-test (br-wandering-union-bd6vcsk6)
Database: mobflow_pdv_test

## Role

Created \`mobflow_api_test\` on the parent test branch. The role is not a superuser, does not have BYPASSRLS, cannot create roles, and cannot create databases.

The Neon role-creation workflow initially grants broad read/write privileges on public tables. Those defaults were immediately revoked. The final explicit grants are:

- \`profiles\`: SELECT only.
- \`app_state\`: SELECT, INSERT, UPDATE only.
- No table privileges on \`companies\`, security tables, recovery-token table, or allowlist.
- No DELETE privilege on application tables.

The role's connection credential is not included in this document or Git history.

## Parent-branch tests

Inserted four synthetic profiles (two tenants, each with one manager and one PDV user) and two synthetic app_state rows.

Using \`mobflow_api_test\`:
- PDV A sees exactly one profile and one app_state row for Tenant A.
- PDV A's attempted update of Tenant B returns no rows.
- Manager A sees exactly two profiles and one app_state row for Tenant A.
- With no transaction-local identity context, profile and app_state visibility is zero.
- The role receives a PostgreSQL permission error when attempting to read \`companies\`, confirming table-level least privilege rather than relying on RLS alone.

Concurrent CAS:
- Two transactions used the exact same expected updated_at timestamp.
- Exactly one updated the row and returned the new timestamp.
- The second returned no row, confirming a conflict.
- The committed writer was singular.

## Cleanup

All synthetic rows were removed:
- profiles = 0
- app_state = 0

The role remains on the isolated test branch for the upcoming server integration work. The schema remains installed. No production resources or production environment variables were touched.

## Remaining work

- Implement and test server-side Supabase Auth verification.
- Implement the session-context and app_state API endpoints.
- Preserve the exact existing browser store behavior and CAS conflict/merge response contract.
- Configure a branch-scoped preview-only Neon connection variable after the user approves the Vercel environment change.
- Run preview integration tests before any production migration or cutover.
