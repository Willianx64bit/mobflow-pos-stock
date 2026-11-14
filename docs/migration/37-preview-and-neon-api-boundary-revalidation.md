# 37 — Preview build and Neon API boundary revalidation

Date: 2026-11-06

## Scope

Validation only on the isolated Git branch `migration/neon-preparation` and Neon test branch `integration-test` in project `mobflow-pdv-test`.

No production deployment, production database, Supabase Auth configuration, stock workflow, receiving RPC, Realtime, polling, or browser session code was changed.

## Vercel Preview

- Deployment: `dpl_6Wbrt2hf1xWMYcBETmGHN5kSkfDF`
- Commit: `1b29599e1181e8f4bc25783e9296af623417783b`
- Branch: `migration/neon-preparation`
- Result: `READY`
- Build used Bun 1.3.14.
- Dependency install reported: `Checked 556 installs across 604 packages (no changes)`.
- Runtime target: Node.js 24.
- This is a docs-only commit and a successful baseline build; it does not mean the application uses Neon yet.

## Neon test role recheck

Connected to database `mobflow_pdv_test` on test branch `br-wandering-union-bd6vcsk6` as `mobflow_api_test`.

- `current_setting('app.user_id', true)` and `current_setting('app.account_id', true)` are NULL on a fresh connection, as expected.
- The role has SELECT on `profiles`.
- The role has SELECT, INSERT, UPDATE on `app_state`.
- No DELETE grant is present.
- No table grants were returned for companies, manager/security, recovery-token, or account-allowlist tables.
- This is a read-only permissions check; no rows were inserted or changed.

## Server boundary recheck

- `src/start.ts` currently installs error middleware and CSRF protection for server functions.
- `src/lib/supabase.ts` continues to own the existing browser Supabase Auth client and local/session storage behavior.
- `src/lib/store.ts` still performs direct Supabase data access. No Neon driver is installed in `package.json`.
- Preserve the current Supabase browser session and validate its access token server-side for any future Neon API request. Never trust browser-supplied user, account, or role identifiers.
- Any Neon identity GUCs must be set transaction-locally on the same connection/transaction used for the query; do not use session-level SET with pooled connections.

## Remaining implementation gates

1. Add a server-only Neon driver using Bun and commit the generated lockfile change on this branch.
2. Implement a server-side Supabase token validation helper without changing the browser auth client.
3. Implement a read-only app_state API and verify tenant isolation through the API.
4. Implement compare-and-swap write semantics with explicit saved/conflict/error responses and server-generated timestamps.
5. Add automated API tests for missing/invalid tokens, tenant A/B isolation, and concurrent writes.
6. Only after those gates pass, plan a separately reviewed gradual store cutover. Do not replace global Supabase calls or receiving RPCs as part of the first cutover.

## Explicit non-goals

Do not merge this branch wholesale into `main`. The two pre-existing Supabase Edge Function files require independent review before any future merge:
- `supabase/functions/mobflow-admin-api/index.ts`
- `supabase/functions/mobflow-manager-password-recovery/index.ts`

Do not change production environment variables, production database schema/data, Supabase Auth, Realtime/polling, Storage, stock movements, receiving RPCs, MobFlow Admin, or ColetaFlow in this phase.
