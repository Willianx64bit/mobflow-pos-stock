# 53 — Auth import rehearsal environment

## Scope
This rehearsal target is isolated from the existing Preview database and from all production databases.

- Neon project: `mobflow-pdv-realtime-test` (`proud-star-34734307`)
- Branch: `realtime-validation` (`br-wild-night-bds1bdfk`)
- Database: `mobflow_auth_import_rehearsal`
- Owner role: `mobflow_pdv_test_owner`

## Target schema
The self-managed Better Auth core schema from `0004_better_auth_core_schema.sql` was reproduced in the dedicated rehearsal database. The following tables were verified empty after setup:

- `public.user`: 0
- `public.account`: 0
- `public.session`: 0
- `public.verification`: 0

No user, password hash, session, or business data was imported.

## GitHub Actions
Added `.github/workflows/auth-import-dry-run.yml` on `migration/neon-preparation`.

- Manual trigger only (`workflow_dispatch`)
- Reads `SUPABASE_DATABASE_URL` and `MOBFLOW_AUTH_DATABASE_URL` from GitHub Actions secrets
- Runs the existing migration utility without `--apply`
- Does not request `CONFIRM_AUTH_IMPORT`
- Does not write user records or password hashes

## Remaining operator setup
Add repository Actions secret `MOBFLOW_AUTH_DATABASE_URL` pointing to the dedicated rehearsal database above. Keep the existing `SUPABASE_DATABASE_URL` secret. Then run the workflow manually from the `migration/neon-preparation` branch.

The workflow has not been dispatched because the target secret cannot be written/read through the available GitHub connection. No secret value should be pasted into chat.

## Safety boundary
This is a dry-run only. Do not add an apply workflow or execute the script with `--apply` until the source validation output has been reviewed and the user explicitly approves a separate import rehearsal. Supabase production and Neon production remain untouched.
