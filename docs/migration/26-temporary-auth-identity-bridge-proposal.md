# Stage 4 — temporary identity bridge design (proposal)

Date: 2026-11-06
Status: proposal for isolated test only; not implemented.

## Objective

Exercise the MobFlow database on the isolated Neon `integration-test` branch while retaining the existing Supabase Auth provider during the database migration phase. Do not migrate passwords, replace login, change JWT issuance, or enable Neon Auth.

## Identity invariants

- A Supabase Auth JWT must be verified cryptographically by a trusted backend using the existing Supabase project configuration/JWKS.
- The verified JWT `sub` is the individual user UUID, corresponding to `profiles.id`.
- The tenant UUID is resolved from the database's `profiles.account_id`, not accepted from browser input.
- A manager typically has account_id equal to their own user UUID; PDV operators share the manager's account_id.
- `profiles.active=false` must reject all protected operations.
- Role and permission checks must use current database profile state, not stale browser sessionStorage flags.
- A caller must never be able to choose another tenant by submitting owner_id/account_id in request JSON.

## Proposed test architecture

1. The frontend continues authenticating with Supabase Auth. No auth client/session code changes in this phase.
2. The frontend sends the Supabase access token to a server-side API endpoint.
3. The backend validates token signature, issuer, audience, expiry, and subject against the expected Supabase project.
4. The backend connects to Neon using a private server-only credential. The browser never receives a Neon database URL or privileged credential.
5. In a single database transaction, the backend establishes a transaction-local verified identity context from the validated JWT subject, then calls narrowly granted database functions. The context must be transaction-local (not session-persistent) to prevent pooled-connection identity leakage.
6. Database helper functions resolve account_id and role from `profiles` for the verified subject and reject missing/inactive profiles. The existing Supabase fallback behavior (missing profile -> subject as account, role -> pdv) must be explicitly reviewed; do not silently carry it over.
7. The API must derive tenant scope inside the server/database path. It must not trust a browser-provided account ID, and must not expose general-purpose SQL or table writes.
8. Neon roles/grants must ensure only the trusted backend role can execute privileged functions. No browser role receives direct table DML or TRUNCATE privileges.
9. Every transaction must set identity context, execute work, and finish/rollback before returning the connection to the pool. Tests must prove that identity cannot leak between consecutive requests.

## Security requirements before implementation

- Validate JWT issuer, audience, expiry, signature and `sub`; reject malformed, expired, wrong-project and revoked/inactive accounts.
- Do not use unverified JWT decoding.
- Do not accept `account_id`, `owner_id`, role, or permissions from client payload as authority.
- Do not use a session-level `SET` that can persist through the connection pool.
- Use transaction-local context and a restricted server-only database role. Consider a SECURITY DEFINER function with fixed empty search_path and strict EXECUTE grants.
- Verify tenant resolution from profiles on every protected operation.
- Keep SQL functions parameterized and narrow; no dynamic SQL based on user-controlled identifiers.
- Test cross-tenant reads/writes, inactive user, missing profile, wrong JWT, token expiry, concurrent requests on reused pooled connections, rollback, and connection reuse.
- Keep Supabase Auth and existing production API untouched during test development.

## Open decisions

- Whether the backend should use a custom API route on the existing host or another trusted server runtime. Decide after inspecting current deployment and secret-management patterns.
- Exact mechanism for transaction-local identity context and how to restrict it to the trusted role.
- Whether to preserve the Supabase fallback for missing profile/account or tighten behavior (recommended: reject missing/inactive profile in the migration target after compatibility tests).
- Which database functions remain SECURITY DEFINER and which become ordinary functions under a restricted role.

## Explicit exclusions

- No Neon Auth provisioning.
- No Supabase Auth migration or password reset.
- No frontend login/session changes.
- No production secrets or database URLs copied into GitHub.
- No DDL/DML or data import in this design checkpoint.
- No Realtime, Storage, or Functions activation.
- No production cutover.
