# 56 — Better Auth lifecycle review: password recovery mismatch

Date: 2026-11-08
Branch: `migration/neon-preparation`
Scope: read-only source audit. No application code, database, credentials, deployment, or production settings changed.

## Finding — manager password recovery does not update the login credential

Severity: **high; Preview acceptance blocker**.

Files reviewed:
- `src/routes/api/mobflow/login.ts`
- `src/routes/api/mobflow/manager-password-recovery.ts`
- `src/routes/api/mobflow/reauth-manager.ts`
- `src/routes/api/mobflow/users.ts`

Observed behavior:
1. The Better Auth login route verifies the supplied password against `public."account".password` using `bcrypt.compare`.
2. The manager recovery reset route consumes the one-time recovery token and updates only `public.manager_security_by_account.password_hash`, using SHA-256.
3. The login route does not read `manager_security_by_account.password_hash`; it reads the Better Auth credential hash in `public."account"`.
4. The manager re-authentication route reads `manager_security_by_account.password_hash` and compares SHA-256. This is a separate secondary security password, not the credential used by the login route.

Impact:
- The recovery endpoint can report that the manager password was changed, while the account's actual login password remains unchanged.
- The new password may work for manager re-authentication, but not for signing in; the previous login password may continue to work.
- This is a functional/security lifecycle mismatch and must be fixed and tested before Better Auth Preview can be accepted or Supabase Auth can be detached.

Required safe correction (not implemented):
- Decide and document whether manager recovery resets the primary Better Auth credential, the separate manager re-authentication secret, or both.
- For a primary login-password reset, update the credential row in `public."account"` with a bcrypt hash in the same database transaction that consumes the one-time token; verify exactly one credential row was updated.
- If the separate manager security password is intended to remain distinct, do not silently treat it as the login password in the UI/message. If both are intentionally reset, update both atomically and clearly describe that behavior.
- Revoke existing sessions after a successful credential reset (the code already uses session deletion in the manager-setup and user-reset flows; recovery should have an explicit equivalent).
- Add automated tests for valid token, expired token, reused token, missing credential row, rollback on failure, old password rejected, new password accepted by the actual login credential check, and session invalidation.
- Keep generic response/rate limiting and one-time token semantics.

## Other reviewed observations

- The Better Auth login route performs custom username/CNPJ/role/subscription checks and then validates the credential hash itself before the browser client signs in through Better Auth. Test the complete two-step sequence in Preview, including wrong role, inactive user, expired subscription, and first manager bootstrap.
- User creation and password reset in `users.ts` write bcrypt hashes to `public."account"`; password reset also deletes that user's sessions.
- Manager re-authentication is a separate SHA-256 secret stored in `manager_security_by_account`; this separation must be preserved intentionally and explained in tests/UI.
- The login bootstrap creates the Better Auth user, credential account, and profile in one transaction. Confirm the configured synthetic email is unique and accepted by Better Auth for every normalized username.

## Status / boundaries

- This is a source-level finding only; no passwords or user rows were read or changed.
- Do not run the auth import `--apply`.
- Do not change the production provider flags, Supabase Auth, Neon production, or Vercel Production.
- Fix and test this in the isolated Preview branch/database before approving the auth migration.
- Supabase usage attribution, R2 migration, Admin proof-reader compatibility, receiving route tests, and event-sync durability remain separate outstanding work.
