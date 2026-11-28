# 56 — Better Auth lifecycle review: password recovery mismatch

Date: 2026-11-08
Branch: `migration/neon-preparation`
Scope: read-only source audit. No application code, database, credentials, deployment, or production settings changed.

## Clarification — manager security-password recovery is intentional

Severity: **not a defect in the intended design**. This feature is specifically for the separate Gerência security password, not the primary account login password.

Files reviewed:
- `src/routes/api/mobflow/login.ts`
- `src/routes/api/mobflow/manager-password-recovery.ts`
- `src/routes/api/mobflow/reauth-manager.ts`
- `src/routes/api/mobflow/users.ts`

Observed behavior:
1. The Better Auth login route verifies the primary login password against `public."account".password` using `bcrypt.compare`.
2. The manager recovery route consumes a one-time recovery token and updates `public.manager_security_by_account.password_hash` using SHA-256.
3. The manager re-authentication route reads that same `manager_security_by_account.password_hash` and compares SHA-256.
4. This is a separate Gerência security password used to revalidate sensitive management actions; it is not the primary login credential.

Intended behavior to preserve:
- Keep recovery restricted to Gerência, using the registered company email and CNPJ validation already present.
- Do not add password recovery for ordinary PDV users.
- Do not change the primary login password when recovering the separate Gerência security password.
- Keep the security password separate from the user's primary sign-in password.

Small UX clarification:
- The current success message says the user can now "entrar com a nova senha". That wording may imply the primary login password changed. Before changing any behavior, clarify the message to say the Gerência security password was changed and can be used when the system asks to revalidate a sensitive action.

Tests to preserve the intended design:
- Recovery is only available to Gerência and validates the company email/CNPJ.
- Valid token, expired token, reused token, rate limit, generic response for non-matching account, and rollback on failure.
- New security password succeeds in manager re-authentication; primary login credential remains unchanged.
- Ordinary PDV users have no recovery route/UI.

Keep generic response/rate limiting and one-time token semantics.

## Other reviewed observations

- The Better Auth login route performs custom username/CNPJ/role/subscription checks and then validates the credential hash itself before the browser client signs in through Better Auth. Test the complete two-step sequence in Preview, including wrong role, inactive user, expired subscription, and first manager bootstrap.
- User creation and password reset in `users.ts` write bcrypt hashes to `public."account"`; password reset also deletes that user's sessions.
- Manager re-authentication is a separate SHA-256 secret stored in `manager_security_by_account`; this separation must be preserved intentionally and explained in tests/UI.
- The login bootstrap creates the Better Auth user, credential account, and profile in one transaction. Confirm the configured synthetic email is unique and accepted by Better Auth for every normalized username.

## Status / boundaries

- This is a source-level clarification only; no passwords or user rows were read or changed.
- Do not run the auth import `--apply`.
- Do not change the production provider flags, Supabase Auth, Neon production, or Vercel Production.
- Fix and test this in the isolated Preview branch/database before approving the auth migration.
- Supabase usage attribution, R2 migration, Admin proof-reader compatibility, receiving route tests, and event-sync durability remain separate outstanding work.
