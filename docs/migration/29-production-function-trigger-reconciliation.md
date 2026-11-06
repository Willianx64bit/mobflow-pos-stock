# Stage 4 — production function and trigger reconciliation

Date: 2026-11-06
Source: read-only catalog query against the MobFlow PDV Supabase production database, plus source SQL files in `migration/neon-preparation`. No SQL was executed against production.

## Exact live application functions

The live catalog returned these seven application functions:

| Schema | Function | Signature | Live behavior |
|---|---|---|---|
| private | `current_account_id` | `() -> uuid` | Resolves `profiles.account_id` by `auth.uid()`; falls back to `auth.uid()`. |
| private | `current_account_role` | `() -> text` | Resolves profile role; falls back to `pdv`. |
| public | `accept_receiving` | `(text) -> boolean` | Locks tenant `app_state`; accepts only `analisando`, decision-completed, not-yet-released receiving; validates each line's decision; adds only accepted quantities to stock; marks status accepted/released. |
| public | `finalize_receiving_decisions` | `(text,jsonb) -> boolean` | Locks tenant `app_state`; validates a non-empty line set and decisions; checks accepted products exist; updates stock and persists decisions/status/release in one transaction. |
| public | `mobflow_save_state` | `(uuid,timestamptz,jsonb) -> jsonb` | Requires authenticated subject and tenant match; validates JSON object; locks row; preserves CAS; returns conflict state/timestamp without overwriting. |
| public | `enforce_mobflow_account_allowlist` | `() -> trigger` | Before Auth user insert, normalizes synthetic username from `@accounts.mobflow.local` email and checks active `account_allowlist`. |
| public | `rls_auto_enable` | `() -> event_trigger` | Supabase event-trigger helper that enables RLS on new public tables. Supabase-specific; do not port as-is. |

All seven definitions were read from the live catalog. The three operational RPCs and the two private identity helpers are SECURITY DEFINER with an empty search_path. Preserve the security properties, but do not copy Supabase's `auth.uid()` dependency into Neon without the server-verified identity bridge.

## Exact application trigger

Only one non-internal application table trigger was returned outside Supabase-managed schemas:

- `auth.users` — `mobflow_account_allowlist`, BEFORE INSERT, invokes `public.enforce_mobflow_account_allowlist()`.

The other returned table triggers belong to Supabase-managed `realtime` and `storage` schemas. Do not recreate those platform triggers in Neon.

## Event triggers

The application event trigger is:

- `ensure_rls` — `ddl_command_end`, invokes `public.rls_auto_enable()`, enabled.

Other returned event triggers belong to Supabase extensions/PostgREST (GraphQL placeholder, pg_cron/net/GraphQL grants, PostgREST DDL/drop watchers). Do not port them to Neon.

## Important production-vs-repository distinction

- Live `accept_receiving` requires status `analisando`, `decisionCompleted=true`, and `stockReleased=false`; it validates decisions across both `items` and `extras`, and adds stock only for decision `aceitar`.
- Live `finalize_receiving_decisions` validates and saves decisions, updates accepted stock, and sets status `aceito` plus `stockReleased=true` even where some individual lines are marked `devolver`. This is current production behavior; do not change its business semantics during a database port.
- The repository file `supabase/migrations/20261028190000_stock_movement_ledger.sql` replaces both receiving RPCs to append `stockMovements` entries. It does not appear in the 28-record production migration history and is not the live function definition. Do not include it in the initial migration.
- The SQL file `20261017000000_mobflow_admin_accounts.sql` is only a partial historical source for the current `companies` shape; the live schema inventory remains authoritative for final columns/indexes/constraints.
- `mobflow_payment_settings` was created in a historical migration and removed by a later historical migration. It is not among the seven current application tables; do not recreate it.

## Security and migration requirements

1. Keep Supabase Auth as the identity provider during the initial database phase.
2. The server must verify the incoming Supabase JWT and derive the subject. Tenant identity must be looked up from trusted profile data.
3. Do not expose password hashes, recovery-token hashes, service-role credentials, or Neon owner credentials.
4. Replace the Auth insert trigger with an explicitly reviewed signup/allowlist server workflow only if signup still needs this control. Do not pretend a Neon database trigger can attach to Supabase Auth.
5. Reimplement the operational receiving functions as narrow server-side transactions with equivalent checks and idempotency.
6. Preserve CAS behavior exactly, including the conflict payload contract consumed by the client.
7. Do not copy Supabase system triggers, extension event triggers, broad grants, or the RLS auto-enable event trigger.
8. The stock ledger is a separate later change and needs its own review and regression tests after the base migration is stable.

## Execution status

Read-only production queries and repository source inspection only. No production DDL/DML, no Neon schema writes, no code edits, no data transfer, and no deployment. The initial Neon schema migration remains blocked on final schema-base and server-runtime reconciliation.
