# Stage 4 — final constraints, indexes, and policy snapshot

Date: 2026-11-06
Source: read-only PostgreSQL catalog queries on Supabase production project `mobflow-pos-stock`.
Scope: exact constraints, indexes, and public RLS policy expressions for the seven application tables. No writes were executed.

## Constraints confirmed

### profiles
- PK: `profiles_pkey(id)`.
- FK `profiles_id_fkey`: `id -> auth.users(id) ON DELETE CASCADE`.
- FK `profiles_account_id_fkey`: `account_id -> auth.users(id) ON DELETE CASCADE`.
- Unique: `profiles_username_key(username)`.
- Check: `profiles_role_check`: role in `manager`, `pdv`, `admin`.

### app_state
- PK: `app_state_pkey(owner_id)`.
- FK `app_state_owner_id_fkey`: `owner_id -> auth.users(id) ON DELETE CASCADE`.

### account_allowlist
- PK: `account_allowlist_pkey(username)`.

### manager_security
- PK: `manager_security_pkey(id)`.
- Check: `manager_security_single_row`: `id = true`.

### manager_security_by_account
- PK: `manager_security_by_account_pkey(account_id)`.
- No FK constraint was returned.

### companies
- PK: `companies_pkey(account_id)`.
- FK `companies_account_id_fkey`: `account_id -> auth.users(id) ON DELETE CASCADE`.
- FK `companies_payment_confirmed_by_fkey`: `payment_confirmed_by -> auth.users(id) ON DELETE SET NULL`.
- Unique constraints: `companies_cnpj_key(cnpj)`, `companies_username_key(username)`.
- Checks:
  - `companies_cnpj_check`: 14 numeric digits.
  - `companies_company_name_check`: trimmed name length 2..120.
  - `companies_monthly_price_check`: > 0 and <= 9999.99.
  - `companies_payment_method_check`: only `pix`.
  - `companies_plan_code_check`: only `complete`.
  - `companies_subscription_status_check`: pending_payment, active, past_due, suspended, cancelled.

### manager_password_recovery_tokens
- PK: `manager_password_recovery_tokens_pkey(id)`.
- FK `manager_password_recovery_tokens_account_id_fkey`: `account_id -> auth.users(id) ON DELETE CASCADE`.
- Unique: `manager_password_recovery_tokens_token_hash_key(token_hash)`.

## Indexes confirmed

- `profiles`: PK(id), unique username, btree(account_id).
- `app_state`: PK(owner_id).
- `account_allowlist`: PK(username).
- `manager_security`: PK(id).
- `manager_security_by_account`: PK(account_id).
- `companies`:
  - PK(account_id)
  - unique CNPJ
  - unique username
  - unique `lower(email)`
  - unique `payment_request_token`
  - unique `manager_setup_token` WHERE token IS NOT NULL
  - `subscription_status`
  - `subscription_expires_at` WHERE value IS NOT NULL
- `manager_password_recovery_tokens`:
  - PK(id)
  - unique token_hash
  - btree(account_id, created_at DESC)

Do not replace the expression or partial indexes with ordinary indexes. They are part of the live uniqueness and query behavior.

## Exact public RLS policy snapshot

Only four public policies were returned:

1. `app_state` / `state account insert`: INSERT for `authenticated`; WITH CHECK requires `owner_id = private.current_account_id()`.
2. `app_state` / `state account select`: SELECT for `authenticated`; USING requires `owner_id = private.current_account_id()`.
3. `app_state` / `state account update`: UPDATE for `authenticated`; USING and WITH CHECK both require `owner_id = private.current_account_id()`.
4. `profiles` / `profiles account select`: SELECT for `authenticated`; USING allows the user's own row (`id = auth.uid()`) or a manager reading rows with the same `account_id` as `private.current_account_id()`.

No public policy was returned for `account_allowlist`, `companies`, `manager_security`, `manager_security_by_account`, or `manager_password_recovery_tokens`. No DELETE policy was returned for `app_state`. Do not create broader policies just to make the Neon migration work; route protected operations through a server authorization layer.

## Identity bridge implications

Six live foreign keys depend on `auth.users`. The first Neon schema cannot simply replay those FK declarations because Supabase Auth remains external to Neon. Before writing migration SQL, choose and document the stable UUID relationship model and enforce it in server-side transactions. Preserve the distinction between individual `profiles.id` and tenant `profiles.account_id`.

## Safety status

This is a catalog snapshot only. No table, constraint, index, policy, grant, or function was changed. No user rows, password hashes, recovery hashes, or credentials were exported.
