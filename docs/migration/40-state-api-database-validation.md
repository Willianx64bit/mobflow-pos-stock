# 40 — State API tests and Neon database validation

Date: 2026-11-06
Branch: `migration/neon-preparation`

## CI result

- The API test suite, dependency installation, and application build completed successfully for commit `2ca1c9e` (run `42301117333`).
- An intermediate run for the first precision-fix commit failed because the GET test still expected the old SQL projection; the assertion was corrected in the following commit, and the complete suite then passed.
- The Preview deployment for the later documentation commit `a308cf9` is `READY`; the code-fix Preview for `2ca1c9e` is also `READY`.
- The new tests cover GET, initial insert, CAS update, HTTP 409 conflict, concurrent request behavior at the handler boundary, invalid JSON/body/state/version, 8 MiB payload limit, and exact version-string preservation.

## Isolated Neon validation

- Project: `mobflow-pdv-test`
- Parent branch: `integration-test`
- Validation branch: `api-state-validation`
- Database: `mobflow_pdv_test`
- Validation branch was created from the integration-test branch. No production database or production branch was accessed.
- A synthetic profile and app_state fixture were created only on the isolated validation branch.

### Actual PostgreSQL CAS

- Two independent concurrent UPDATE requests used the same original `updated_at` version.
- Exactly one UPDATE returned a row; the other returned zero rows.
- The persisted state matched the winning writer.
- This confirms PostgreSQL's conditional update is atomic under the tested race.

### First-save race

- Two independent concurrent INSERT requests used the same new `owner_id` with `ON CONFLICT (owner_id) DO NOTHING RETURNING ...`.
- Exactly one INSERT returned a row; the other returned zero rows.
- The final table contained exactly one state row for the synthetic account.

### RLS isolation

- Connected using the limited `mobflow_api_test` role.
- Set transaction-local identity context for the test PDV user.
- The PDV could read only its own profile.
- The PDV could read the single account-level app_state row.
- No other tenant's profile was returned.

### Timestamp precision issue found and fixed in source

- PostgreSQL `timestamptz` preserves microseconds.
- The default node-postgres date parser converts timestamptz to JavaScript Date, which serializes to ISO timestamps with millisecond precision.
- The CAS update deliberately advances `updated_at` by at least one microsecond. Returning it as Date could therefore truncate the version sent back to the client and make the next CAS compare against a timestamp that does not exactly match the database.
- The state API now formats `updated_at` in SQL as an ISO-8601 UTC string with six fractional digits using `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` for GET, INSERT RETURNING, UPDATE RETURNING, and conflict reads.
- On the isolated Neon branch, repeated updates using exact microsecond versions succeeded: `.000001Z` → `.000002Z` → `.000003Z`.
- A regression test now verifies that the API response preserves all six fractional digits.

## Remaining validation

- Validate the protected Preview HTTP endpoints using an authorized Vercel access path and a real Supabase test session. Do not weaken Deployment Protection.
- Confirm authenticated API first-save, subsequent-save, conflict response, and cross-tenant denial end-to-end.
- Keep `src/lib/store.ts` untouched until the API and compatibility boundary are fully verified.
- Keep Supabase Auth, Realtime, polling, receiving RPCs, stock, sales, and production unchanged.
