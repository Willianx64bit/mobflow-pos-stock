# Stage 4 — identity bridge and server database access decision

Date: 2026-11-06
Status: architecture decision for isolated testing only; not implemented.

## 1. Verified tenant/profile relationships

A read-only aggregate query against production returned:

- 7 profiles: 2 manager, 5 PDV, 0 admin.
- 0 profiles whose account_id has no matching profiles.id.
- 0 companies whose account_id has no matching profile.
- 0 app_state rows whose owner_id has no matching profile.
- 0 recovery-token rows whose account_id has no matching profile.
- 0 non-null payment-confirming user IDs without a matching profile.

This supports a testable relationship model using stable Supabase Auth UUIDs as the profile primary keys. It does not prove all possible future account flows, so the same constraints must be tested with synthetic fixtures and signup/admin scenarios.

## 2. Proposed temporary identity bridge

Keep Supabase Auth as the identity provider. The browser continues to obtain and refresh the same Supabase session.

For every protected server request:

1. Read the Supabase access token from the request's Authorization header or existing authenticated server context.
2. Validate it using the Supabase Auth server-side user-verification endpoint (do not trust decoded JWT claims alone).
3. Take the verified user UUID (sub) from the Auth response.
4. In a single Neon transaction, load profiles by that UUID.
5. Reject missing or inactive profiles. Do not fall back to the UUID as an account ID when a profile is missing.
6. Derive tenant from profiles.account_id; derive role and permissions from the database row.
7. Never accept user ID, account ID, role, or permissions from request body as authorization authority.

This keeps the existing user IDs stable and avoids migrating passwords, refresh tokens, or Supabase Auth users in the first database phase.

## 3. Proposed FK model for Neon

Supabase's auth.users schema is external to Neon, so the current FKs cannot be copied literally. The live aggregate check supports replacing those references with the profile identity table while preserving the same UUID values:

- profiles.id: primary key representing the verified Supabase Auth subject; remove only the external FK to auth.users.
- profiles.account_id: FK to profiles(id), ON DELETE CASCADE.
- app_state.owner_id: FK to profiles(id), ON DELETE CASCADE.
- companies.account_id: FK to profiles(id), ON DELETE CASCADE.
- companies.payment_confirmed_by: FK to profiles(id), ON DELETE SET NULL.
- manager_password_recovery_tokens.account_id: FK to profiles(id), ON DELETE CASCADE.

The profile row is not proof of authentication by itself: every request still requires successful Supabase Auth verification. The server must also check profiles.active.

### Deletion caveat

External deletion in Supabase Auth will no longer automatically cascade into Neon. The future server-side user deletion workflow must explicitly deactivate/delete the Neon profile and dependent rows, then delete the Supabase Auth identity with a retry/reconciliation strategy. Do not silently leave this behavior undocumented. In the first migration/test phase, prefer deactivation and preserve audit/history unless a reviewed deletion contract requires physical deletion.

## 4. Proposed Vercel server database driver

Read-only deployment metadata for the latest preview showed:
- Deployment type: LAMBDAS.
- Project Node version: 24.x.
- Preview region: iad1.
- Framework metadata: tanstack-start-lovable.

Given the deployed Vercel Lambda/Node runtime, the preferred test prototype is standard pg with the Neon pooled connection endpoint, not a browser-side Neon driver. The server should use a small reusable Pool, acquire a dedicated client for each multi-statement transaction, and always release it in finally. The connection string stays in a server-only environment variable.

Use transaction-local identity context only after JWT verification (for example, SET LOCAL inside the same transaction); never use session-level identity state that can leak across pooled requests. Keep all queries parameterized.

Neon's official guidance recommends pooled connection strings for application traffic. Its serverless driver supports Vercel serverless/edge runtimes too, but the current app's verified Lambda/Node runtime and need for multi-statement transactional operations make the standard Node Postgres driver the simpler first prototype. Re-evaluate if the deployment target changes to Edge/Cloudflare.

## 5. First server API scope (not yet implemented)

The first vertical slice should be deliberately narrow:
- GET /api/mobflow/session-context: validate Supabase token and return the current profile's tenant/role/permissions.
- GET /api/mobflow/state: read only the current tenant's app_state.
- POST /api/mobflow/state: preserve the existing CAS request/response contract and conflict behavior.
- One transaction test that proves verified subject and tenant are transaction-local and cannot leak when a pooled connection is reused.

Do not migrate receiving RPCs, admin APIs, Storage, Realtime, stock ledger, or browser store in this first vertical slice. The browser remains on the current Supabase data path until the server slice is proven against synthetic fixtures.

## 6. Required tests before implementation can progress

- Valid Supabase token for active manager and active PDV user.
- Invalid/expired token, missing profile, inactive profile, unsupported role.
- Client attempts to forge user ID, account ID, role, or permissions.
- Two tenants cannot read/write each other's state.
- A pooled connection reused by tenant B cannot inherit tenant A's identity context.
- CAS succeeds, conflicts, retries, and preserves exact response shape.
- User deactivation immediately denies subsequent requests.
- Auth deletion and Neon cleanup retry behavior is defined and tested.

## 7. Safety status

Architecture only. No packages installed, no code or environment variables changed, no Neon SQL applied, no data moved, no production settings changed, no deployment target changed. Supabase Auth, current store, Realtime, polling, stock logic, and receiving flows remain untouched.
