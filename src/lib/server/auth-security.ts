import { createHmac, randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";

const WINDOW_MINUTES = 30;
const LOCKOUT_FAILURES = 3;
const CAPTCHA_FAILURES = 2;

type ScopeType = "login" | "manager_password" | "ip" | "device" | "company";

export type LoginSecurityStatus = {
  blockedUntil: Date | null;
  captchaRequired: boolean;
  retryAfterSeconds: number;
};

function digest(scope: ScopeType, value: string): string {
  const secret = process.env["BETTER_AUTH_SECRET"]?.trim();
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required for authentication security.");
  return createHmac("sha256", secret).update(`mobflow:${scope}:${value}`, "utf8").digest("hex");
}

function clientIp(request: Request): string {
  // Vercel overwrites x-real-ip. Never trust a custom X-Forwarded-For value
  // when x-real-ip is available.
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 128);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? forwarded.slice(0, 128) : "unknown";
}

function deviceId(request: Request): string {
  const value = request.headers.get("x-mobflow-device")?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : "unknown";
}

function usernameKey(username: string): string {
  return username.trim().toLowerCase().replace(/@accounts\.mobflow\.local$/i, "");
}

export async function acquireLoginAttemptLock(client: PoolClient, username: string): Promise<string> {
  const lockKey = digest("login", usernameKey(username));
  // Session-level advisory lock survives transaction rollback, so a failed
  // attempt remains serialized until its counter has been committed.
  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
  return lockKey;
}

export async function releaseLoginAttemptLock(client: PoolClient, lockKey: string): Promise<void> {
  await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]);
}

async function getScopeState(client: PoolClient, scope: ScopeType, value: string) {
  const scopeHash = digest(scope, value);
  const result = await client.query<{ failure_count: number; blocked_until: Date | null }>(
    `SELECT failure_count, blocked_until
     FROM public.mobflow_auth_security_state
     WHERE scope_type = $1 AND scope_hash = $2
     LIMIT 1`,
    [scope, scopeHash],
  );
  return { hash: scopeHash, count: Number(result.rows[0]?.failure_count ?? 0), blockedUntil: result.rows[0]?.blocked_until ?? null };
}

export async function checkLoginSecurity(
  client: PoolClient,
  request: Request,
  username: string,
  cnpj?: string,
  includeDeviceRisk = true,
): Promise<LoginSecurityStatus> {
  const login = await getScopeState(client, "login", usernameKey(username));
  const ip = await getScopeState(client, "ip", clientIp(request));
  const device = await getScopeState(client, "device", deviceId(request));
  const company = cnpj ? await getScopeState(client, "company", cnpj.replace(/\D/g, "")) : null;
  const blockedUntil = login.blockedUntil && login.blockedUntil.getTime() > Date.now() ? login.blockedUntil : null;
  return {
    blockedUntil,
    captchaRequired: ip.count >= CAPTCHA_FAILURES || (includeDeviceRisk && device.count >= CAPTCHA_FAILURES) || (company?.count ?? 0) >= CAPTCHA_FAILURES,
    retryAfterSeconds: blockedUntil ? Math.max(1, Math.ceil((blockedUntil.getTime() - Date.now()) / 1000)) : 0,
  };
}

async function incrementScope(client: PoolClient, scope: ScopeType, value: string, lockout: boolean) {
  const scopeHash = digest(scope, value);
  const result = await client.query<{ failure_count: number; blocked_until: Date | null }>(
    `INSERT INTO public.mobflow_auth_security_state
       (scope_type, scope_hash, failure_count, window_started_at, last_failure_at, blocked_until, updated_at)
     VALUES ($1, $2, 1, now(), now(), NULL, now())
     ON CONFLICT (scope_type, scope_hash) DO UPDATE SET
       failure_count = CASE
         WHEN public.mobflow_auth_security_state.last_failure_at < now() - ($3::text || ' minutes')::interval THEN 1
         ELSE public.mobflow_auth_security_state.failure_count + 1
       END,
       window_started_at = CASE
         WHEN public.mobflow_auth_security_state.last_failure_at < now() - ($3::text || ' minutes')::interval THEN now()
         ELSE public.mobflow_auth_security_state.window_started_at
       END,
       last_failure_at = now(),
       blocked_until = CASE
         WHEN $4::boolean AND (
           CASE
             WHEN public.mobflow_auth_security_state.last_failure_at < now() - ($3::text || ' minutes')::interval THEN 1
             ELSE public.mobflow_auth_security_state.failure_count + 1
           END
         ) >= $5 THEN now() + interval '30 minutes'
         WHEN public.mobflow_auth_security_state.blocked_until > now() THEN public.mobflow_auth_security_state.blocked_until
         ELSE NULL
       END,
       updated_at = now()
     RETURNING failure_count, blocked_until`,
    [scope, scopeHash, WINDOW_MINUTES, lockout, LOCKOUT_FAILURES],
  );
  return { hash: scopeHash, count: Number(result.rows[0]?.failure_count ?? 0), blockedUntil: result.rows[0]?.blocked_until ?? null };
}

export async function recordLoginFailure(
  client: PoolClient,
  request: Request,
  username: string,
  cnpj?: string,
) {
  const login = await incrementScope(client, "login", usernameKey(username), true);
  const ip = await incrementScope(client, "ip", clientIp(request), false);
  const device = await incrementScope(client, "device", deviceId(request), false);
  const company = cnpj ? await incrementScope(client, "company", cnpj.replace(/\D/g, ""), false) : null;
  await client.query(
    `INSERT INTO public.mobflow_auth_security_events (event_type, scope_type, scope_hash, blocked_until)
     VALUES ('login_failed', 'login', $1, $2)`,
    [login.hash, login.blockedUntil],
  );
  return { blockedUntil: login.blockedUntil, ipFailures: ip.count, deviceFailures: device.count, companyFailures: company?.count ?? 0 };
}

export async function recordLoginSuccess(client: PoolClient, _request: Request, username: string, cnpj?: string) {
  const loginHash = digest("login", usernameKey(username));
  const deviceHash = digest("device", deviceId(_request));
  const ipHash = digest("ip", clientIp(_request));
  const companyHash = cnpj ? digest("company", cnpj.replace(/\D/g, "")) : null;
  // A successful password check is reached only after any required Turnstile
  // challenge has passed. Clear shared risk counters so a legitimate login
  // does not keep the device/IP stuck behind a challenge.
  await client.query(
    `UPDATE public.mobflow_auth_security_state
     SET failure_count = 0, blocked_until = NULL, window_started_at = now(), last_failure_at = NULL, updated_at = now()
     WHERE (scope_type = 'login' AND scope_hash = $1)
        OR (scope_type = 'device' AND scope_hash = $2)
        OR (scope_type = 'ip' AND scope_hash = $3)
        OR ($4::text IS NOT NULL AND scope_type = 'company' AND scope_hash = $4)`,
    [loginHash, deviceHash, ipHash, companyHash],
  );
  await client.query(
    `INSERT INTO public.mobflow_auth_security_events (event_type, scope_type, scope_hash)
     VALUES ('login_succeeded', 'login', $1)`,
    [loginHash],
  );
}

export async function checkManagerPasswordLockout(client: PoolClient, accountId: string) {
  const state = await getScopeState(client, "manager_password", accountId);
  const blockedUntil = state.blockedUntil && state.blockedUntil.getTime() > Date.now() ? state.blockedUntil : null;
  return {
    blockedUntil,
    retryAfterSeconds: blockedUntil ? Math.max(1, Math.ceil((blockedUntil.getTime() - Date.now()) / 1000)) : 0,
  };
}

export async function recordManagerPasswordFailure(client: PoolClient, accountId: string) {
  const state = await incrementScope(client, "manager_password", accountId, true);
  await client.query(
    `INSERT INTO public.mobflow_auth_security_events (event_type, scope_type, scope_hash, account_id, blocked_until)
     VALUES ('manager_password_failed', 'manager_password', $1, $2, $3)`,
    [state.hash, accountId, state.blockedUntil],
  );
  return state;
}

export async function recordManagerPasswordSuccess(client: PoolClient, accountId: string) {
  const scopeHash = digest("manager_password", accountId);
  await client.query(
    `UPDATE public.mobflow_auth_security_state
     SET failure_count = 0, blocked_until = NULL, window_started_at = now(), last_failure_at = NULL, updated_at = now()
     WHERE scope_type = 'manager_password' AND scope_hash = $1`,
    [scopeHash],
  );
  await client.query(
    `INSERT INTO public.mobflow_auth_security_events (event_type, scope_type, scope_hash, account_id)
     VALUES ('manager_password_succeeded', 'manager_password', $1, $2)`,
    [scopeHash, accountId],
  );
}


export async function enforcePublicRateLimit(
  client: PoolClient,
  request: Request,
  endpoint: string,
  maxRequests: number,
  windowMinutes = 60,
  blockMinutes = 60,
) {
  const ip = clientIp(request);
  if (ip === "unknown") return { blockedUntil: null as Date | null, retryAfterSeconds: 0 };
  const scopeHash = digest("ip", `public-api:${endpoint}:${ip}`);
  const existing = await client.query<{ blocked_until: Date | null }>(
    `SELECT blocked_until FROM public.mobflow_auth_security_state
     WHERE scope_type = 'ip' AND scope_hash = $1 LIMIT 1`,
    [scopeHash],
  );
  const currentBlock = existing.rows[0]?.blocked_until ?? null;
  if (currentBlock && currentBlock.getTime() > Date.now()) {
    return {
      blockedUntil: currentBlock,
      retryAfterSeconds: Math.max(1, Math.ceil((currentBlock.getTime() - Date.now()) / 1000)),
    };
  }

  const result = await client.query<{ failure_count: number; blocked_until: Date | null }>(
    `INSERT INTO public.mobflow_auth_security_state
       (scope_type, scope_hash, failure_count, window_started_at, last_failure_at, blocked_until, updated_at)
     VALUES ('ip', $1, 1, now(), now(), NULL, now())
     ON CONFLICT (scope_type, scope_hash) DO UPDATE SET
       failure_count = CASE
         WHEN public.mobflow_auth_security_state.last_failure_at < now() - ($2::text || ' minutes')::interval THEN 1
         ELSE public.mobflow_auth_security_state.failure_count + 1
       END,
       window_started_at = CASE
         WHEN public.mobflow_auth_security_state.last_failure_at < now() - ($2::text || ' minutes')::interval THEN now()
         ELSE public.mobflow_auth_security_state.window_started_at
       END,
       last_failure_at = now(),
       blocked_until = CASE
         WHEN (
           CASE
             WHEN public.mobflow_auth_security_state.last_failure_at < now() - ($2::text || ' minutes')::interval THEN 1
             ELSE public.mobflow_auth_security_state.failure_count + 1
           END
         ) > $3 THEN now() + ($4::text || ' minutes')::interval
         WHEN public.mobflow_auth_security_state.blocked_until > now() THEN public.mobflow_auth_security_state.blocked_until
         ELSE NULL
       END,
       updated_at = now()
     RETURNING failure_count, blocked_until`,
    [scopeHash, windowMinutes, maxRequests, blockMinutes],
  );
  const blockedUntil = result.rows[0]?.blocked_until ?? null;
  return {
    blockedUntil,
    retryAfterSeconds: blockedUntil && blockedUntil.getTime() > Date.now()
      ? Math.max(1, Math.ceil((blockedUntil.getTime() - Date.now()) / 1000))
      : 0,
  };
}

export async function verifyCompanyLoginCaptcha(request: Request, token: string): Promise<boolean> {
  const secret = process.env["TURNSTILE_SECRET"]?.trim();
  const allowedHosts = (process.env["TURNSTILE_HOSTNAMES"] ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  const requestHost = new URL(request.url).hostname.toLowerCase();
  if (!secret || !allowedHosts.includes(requestHost) || !token || token.length > 2048) return false;

  const body = new URLSearchParams({ secret, response: token, idempotency_key: randomUUID() });
  const ip = clientIp(request);
  if (ip !== "unknown") body.set("remoteip", ip);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean; hostname?: string };
    return result.success === true && typeof result.hostname === "string" &&
      allowedHosts.includes(result.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export type LoginAuditEventInput = {
  username: string;
  cnpj?: string;
  role: "manager" | "pdv";
  eventType: "login_succeeded" | "login_failed" | "login_blocked" | "login_denied" | "captcha_rejected";
  success: boolean;
  httpStatus: number;
  accountId?: string | null;
  location?: unknown;
};

function clientAgentDetails(request: Request) {
  const userAgent = request.headers.get("user-agent")?.slice(0, 512) ?? "";
  const browser = /Edg\//i.test(userAgent) ? "Microsoft Edge"
    : /OPR\//i.test(userAgent) ? "Opera"
    : /Firefox\//i.test(userAgent) ? "Firefox"
    : /Chrome\//i.test(userAgent) ? "Google Chrome"
    : /Safari\//i.test(userAgent) ? "Safari"
    : "Desconhecido";
  const operatingSystem = /Android/i.test(userAgent) ? "Android"
    : /iPhone|iPad|iPod/i.test(userAgent) ? "iOS"
    : /Windows NT/i.test(userAgent) ? "Windows"
    : /Mac OS X/i.test(userAgent) ? "macOS"
    : /Linux/i.test(userAgent) ? "Linux"
    : "Desconhecido";
  return { userAgent: userAgent || null, browser, operatingSystem };
}

export async function recordLoginAuditEvent(
  client: PoolClient,
  request: Request,
  input: LoginAuditEventInput,
): Promise<void> {
  const rawLocation = input.location && typeof input.location === "object"
    ? input.location as Record<string, unknown>
    : {};
  const permissionValue = String(rawLocation["permission"] ?? "not_requested");
  const locationPermission = ["granted", "denied", "unavailable", "not_requested"].includes(permissionValue)
    ? permissionValue
    : "unavailable";
  const latitude = typeof rawLocation["latitude"] === "number" ? rawLocation["latitude"] : Number.NaN;
  const longitude = typeof rawLocation["longitude"] === "number" ? rawLocation["longitude"] : Number.NaN;
  const accuracy = typeof rawLocation["accuracy"] === "number" ? rawLocation["accuracy"] : Number.NaN;
  const altitude = typeof rawLocation["altitude"] === "number" ? rawLocation["altitude"] : Number.NaN;
  const altitudeAccuracy = typeof rawLocation["altitudeAccuracy"] === "number" ? rawLocation["altitudeAccuracy"] : Number.NaN;
  const positionTimestamp = typeof rawLocation["positionTimestamp"] === "number" ? rawLocation["positionTimestamp"] : Number.NaN;
  // Clientes atualizados enviam timestamp para rejeitar uma posição antiga.
  // Compatibilidade: versões anteriores não enviavam esse campo.
  const freshPosition = !Number.isFinite(positionTimestamp) ||
    Math.abs(Date.now() - positionTimestamp) <= 120000;
  const hasCoordinates = locationPermission === "granted" && freshPosition &&
    Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  const ip = clientIp(request);
  const device = deviceId(request);
  const agent = clientAgentDetails(request);
  const accountId = input.accountId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.accountId)
    ? input.accountId
    : null;
  const cnpj = input.cnpj && /^\d{14}$/.test(input.cnpj) ? input.cnpj : null;
  const header = (name: string) => {
    const value = request.headers.get(name)?.trim();
    if (!value) return null;
    try { return decodeURIComponent(value).slice(0, 160); } catch { return value.slice(0, 160); }
  };

  await client.query(
    "INSERT INTO public.mobflow_login_audit_events " +
    "(account_id, company_cnpj, attempted_username, attempted_role, event_type, success, " +
    "http_status, ip_address, device_id, user_agent, browser, operating_system, " +
    "country, region, city, location_permission, latitude, longitude, location_accuracy_m, altitude_m, altitude_accuracy_m) " +
    "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)",
    [
      accountId, cnpj, input.username.trim().slice(0, 128) || "(vazio)", input.role,
      input.eventType, input.success, input.httpStatus,
      ip === "unknown" ? null : ip, device === "unknown" ? null : device,
      agent.userAgent, agent.browser, agent.operatingSystem,
      header("x-vercel-ip-country"), header("x-vercel-ip-country-region"), header("x-vercel-ip-city"),
      locationPermission, hasCoordinates ? latitude : null, hasCoordinates ? longitude : null,
      hasCoordinates && Number.isFinite(accuracy) && accuracy > 0 ? Math.min(accuracy, 100000) : null,
      hasCoordinates && Number.isFinite(altitude) && altitude >= -12000 && altitude <= 100000 ? altitude : null,
      hasCoordinates && Number.isFinite(altitudeAccuracy) && altitudeAccuracy > 0 ? Math.min(altitudeAccuracy, 100000) : null,
    ],
  );
}
