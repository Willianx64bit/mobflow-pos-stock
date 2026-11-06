# Stage 4 — live schema inventory checkpoint

Date: 2026-11-06
Source: read-only catalog queries and Supabase table introspection on production project `ezkwubdpblqkdfampopa`.

## Important interpretation of connector row summaries

The Supabase table-listing tool reports `rows: 0` in its compact/verbose schema response even when independent live `COUNT(*)` queries return records. Treat the explicit COUNT(*) values in document 24 as the row-count baseline. Do not use the table-listing `rows` field for data-volume decisions.

## Exact application table inventory

### public.profiles
- `id uuid NOT NULL` — PK; FK to `auth.users(id)`, ON DELETE CASCADE.
- `username text NOT NULL` — UNIQUE.
- `cnpj text NOT NULL`.
- `created_at timestamptz NOT NULL DEFAULT now()`.
- `account_id uuid NOT NULL` — FK to `auth.users(id)`, ON DELETE CASCADE.
- `role text NOT NULL DEFAULT 'manager'` — CHECK in manager/pdv/admin.
- `active boolean NOT NULL DEFAULT true`.
- `display_name text NULL`.
- `permissions jsonb NOT NULL DEFAULT '["PDV", "Conferência"]'::jsonb`.
- Index: PK(id), unique(username), btree(account_id).

### public.app_state
- `owner_id uuid NOT NULL` — PK; FK to `auth.users(id)`, ON DELETE CASCADE.
- `state jsonb NOT NULL`.
- `updated_at timestamptz NOT NULL DEFAULT now()`.
- Index: PK(owner_id).

### public.account_allowlist
- `username text NOT NULL` — PK.
- `cnpj text NOT NULL`.
- `active boolean NOT NULL DEFAULT true`.
- `created_at timestamptz NOT NULL DEFAULT now()`.
- Index: PK(username).

### public.manager_security
- `id boolean NOT NULL DEFAULT true` — PK and CHECK(id=true), enforcing a single row.
- `password_hash text NOT NULL`.
- Index: PK(id).

### public.manager_security_by_account
- `account_id uuid NOT NULL` — PK.
- `password_hash text NOT NULL`.
- `updated_at timestamptz NOT NULL DEFAULT now()`.
- Index: PK(account_id).
- No FK was returned by the live constraint catalog.

### public.companies
- `account_id uuid NOT NULL` — PK; FK to `auth.users(id)`, ON DELETE CASCADE.
- `company_name text NOT NULL` — trimmed length 2..120.
- `cnpj text NOT NULL` — 14 digits, UNIQUE.
- `username text NOT NULL` — UNIQUE.
- `email text NOT NULL` — unique lower(email) index.
- `phone text NOT NULL`.
- `plan_code text NOT NULL DEFAULT 'complete'` — CHECK complete.
- `monthly_price numeric(10,2) NOT NULL DEFAULT 69.90` — >0 and <=9999.99.
- `subscription_status text NOT NULL DEFAULT 'pending_payment'` — pending_payment/active/past_due/suspended/cancelled.
- `created_at timestamptz NOT NULL DEFAULT now()`.
- `updated_at timestamptz NOT NULL DEFAULT now()`.
- `payment_method text NOT NULL DEFAULT 'pix'` — CHECK pix.
- `payment_confirmed_at timestamptz NULL`.
- `payment_confirmed_by uuid NULL` — FK to auth.users(id), ON DELETE SET NULL.
- `payment_notes text NULL`.
- `payment_request_token uuid NOT NULL DEFAULT gen_random_uuid()` — unique index.
- `payment_proof_path text NULL`.
- `payment_submitted_at timestamptz NULL`.
- `manager_setup_token uuid NULL` — partial unique index when not null.
- `manager_setup_completed_at timestamptz NULL`.
- `subscription_expires_at timestamptz NULL` — partial index when not null.
- Additional indexes: subscription_status, subscription_expires_at (partial), unique lower(email), unique manager_setup_token (partial), unique payment_request_token, PK(account_id), unique cnpj, unique username.

### public.manager_password_recovery_tokens
- `id uuid NOT NULL DEFAULT gen_random_uuid()` — PK.
- `account_id uuid NOT NULL` — FK to auth.users(id), ON DELETE CASCADE.
- `token_hash text NOT NULL` — UNIQUE.
- `expires_at timestamptz NOT NULL`.
- `used_at timestamptz NULL`.
- `created_at timestamptz NOT NULL DEFAULT now()`.
- Additional index: (account_id, created_at DESC).

## Constraints and objects

- All seven tables have RLS enabled; FORCE RLS is false.
- Four policies returned: app_state SELECT/INSERT/UPDATE, and profiles SELECT. No DELETE policy for app_state.
- No public/private views or materialized views.
- Application functions include current_account_id, current_account_role, mobflow_save_state, accept_receiving, finalize_receiving_decisions, enforce_mobflow_account_allowlist, and rls_auto_enable.
- The auth.users BEFORE INSERT trigger is mobflow_account_allowlist.
- The public-schema event trigger ensure_rls automatically enables RLS on new public tables.
- Important application indexes and constraints are enumerated above. Do not omit the expression/partial indexes on companies during porting.
- Do not copy Supabase system objects/event triggers, ownership, or broad grants into Neon.

## Migration cautions

1. The six FK dependencies on `auth.users` must be redesigned for the temporary Supabase Auth → Neon server-side identity bridge. Do not replace them with unconstrained UUIDs without a documented authorization model.
2. Preserve the JSONB `app_state.state` payload and optimistic concurrency contract exactly in the first test migration.
3. Preserve CHECK constraints and partial/expression indexes.
4. Password hashes in manager_security tables are application-managed security data; never print, export into docs, or expose their values.
5. Do not move `payment_proof_path` storage objects or alter Storage in this schema-only phase.
6. `rls_auto_enable` is a Supabase DDL event-trigger pattern; do not recreate blindly in Neon. Explicitly enable RLS on each created table and review policies/grants.
7. This is a catalog-derived inventory, not yet a complete `pg_dump --schema-only`. Ownership, every ACL detail, and every system dependency still require final reconciliation before the schema migration is applied.
