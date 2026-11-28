# 42 — PG18 Realtime test branch: schema and tenant-isolation validation

Date: 2026-11-06
Project: `mobflow-pdv-realtime-test` (`proud-star-34734307`)
Branch: `realtime-validation` (`br-wild-night-bds1bdfk`)
Database: `mobflow_pdv_test`
Scope: isolated test environment only.

## Environment
- PostgreSQL 18.6 confirmed.
- Neon Realtime enabled; provisioning complete; allowed origin is the migration Preview origin.
- Neon Managed Auth (Better Auth) provisioned; email/password enabled and public sign-up disabled.
- The branch has no production records or imported customer data.

## Schema application
Applied the existing, previously tested `neon/migrations/0001_initial_schema.sql` to this isolated branch.
Read-only verification:
- 7 public application tables.
- 4 public RLS policies.
- RLS enabled on all 7 public application tables.
- Neon Auth's separate `neon_auth` schema is present.

## Synthetic tenant-isolation checks
Created synthetic fixtures only: two tenants, each with one manager, one PDV profile, and one app_state row. Created a non-superuser, non-BYPASSRLS test role `mobflow_api_test` and tested under that role.

Results:
- Tenant A PDV sees only its own profile and Tenant A state.
- Tenant B PDV sees only its own profile and Tenant B state.
- Tenant B's attempt to update Tenant A state returns zero rows.
- Tenant A manager sees the two profiles in Tenant A and only Tenant A state.
- No production data or identities were copied or modified.

## Boundaries and remaining work
- The schema and SQL-level tenant RLS checks are validated on PG18.
- The app still uses Supabase Auth in the browser; Neon Auth is provisioned but not integrated into app login.
- The existing Preview `NEON_DATABASE_URL` still points to the earlier PG17 test project. It was not changed.
- No new API integration, store cutover, Realtime client subscription, production setting, or production data migration was performed.
- Next: implement and test the auth/API path against this PG18 branch, then verify authenticated HTTP requests and only then adapt the app_state store. Realtime client integration remains a separate step and may be completed later without blocking the core migration.
