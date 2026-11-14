import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  checkLoginSecurity,
  recordLoginFailure,
  recordLoginAuditEvent,
  checkManagerPasswordLockout,
  recordManagerPasswordFailure,
  enforcePublicRateLimit,
  verifyCompanyLoginCaptcha,
} from "@/lib/server/auth-security";

const DEVICE_ID = "a8b9c0d1-e2f3-4a56-8b9c-0d1e2f3a4b5c";
const ACCOUNT_ID = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const USERNAME = "private-manager";
const IP = "203.0.113.42";

function mockClient(query: ReturnType<typeof vi.fn>) {
  return { query } as unknown as PoolClient;
}

describe("MobFlow persistent authentication security", () => {
  const originalSecret = process.env["BETTER_AUTH_SECRET"];
  const originalTurnstileSecret = process.env["TURNSTILE_SECRET"];
  const originalTurnstileHostnames = process.env["TURNSTILE_HOSTNAMES"];

  beforeEach(() => {
    process.env["BETTER_AUTH_SECRET"] = "unit-test-only-secret";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env["BETTER_AUTH_SECRET"];
    else process.env["BETTER_AUTH_SECRET"] = originalSecret;
    if (originalTurnstileSecret === undefined) delete process.env["TURNSTILE_SECRET"];
    else process.env["TURNSTILE_SECRET"] = originalTurnstileSecret;
    if (originalTurnstileHostnames === undefined) delete process.env["TURNSTILE_HOSTNAMES"];
    else process.env["TURNSTILE_HOSTNAMES"] = originalTurnstileHostnames;
    vi.unstubAllGlobals();
  });

  it("detects account lockout and requests Turnstile when IP/device risk is elevated", async () => {
    const blockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    const query = vi.fn(async (_sql: string, values: unknown[]) => {
      const scope = values[0];
      if (scope === "login") return { rows: [{ failure_count: 3, blocked_until: blockedUntil }] };
      if (scope === "ip") return { rows: [{ failure_count: 2, blocked_until: null }] };
      return { rows: [{ failure_count: 2, blocked_until: null }] };
    });
    const request = new Request("https://preview.mobflow.test/api/mobflow/login", {
      headers: { "x-real-ip": IP, "x-mobflow-device": DEVICE_ID },
    });

    const status = await checkLoginSecurity(mockClient(query), request, USERNAME);

    expect(status.blockedUntil).toEqual(blockedUntil);
    expect(status.captchaRequired).toBe(true);
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
    const serializedParams = JSON.stringify(query.mock.calls.map((call) => call[1]));
    expect(serializedParams).not.toContain(USERNAME);
    expect(serializedParams).not.toContain(IP);
    expect(serializedParams).not.toContain(DEVICE_ID);
  });

  it("starts a 30-minute identity lockout on the third consecutive failed login", async () => {
    let identityFailures = 0;
    const blockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("INSERT INTO public.mobflow_auth_security_state")) {
        const scope = values[0];
        if (scope === "login") {
          identityFailures += 1;
          return { rows: [{ failure_count: identityFailures, blocked_until: identityFailures >= 3 ? blockedUntil : null }] };
        }
        return { rows: [{ failure_count: 1, blocked_until: null }] };
      }
      return { rows: [] };
    });
    const request = new Request("https://preview.mobflow.test/api/mobflow/login", {
      headers: { "x-real-ip": IP, "x-mobflow-device": DEVICE_ID },
    });

    const first = await recordLoginFailure(mockClient(query), request, USERNAME);
    const second = await recordLoginFailure(mockClient(query), request, USERNAME);
    const third = await recordLoginFailure(mockClient(query), request, USERNAME);

    expect(first.blockedUntil).toBeNull();
    expect(second.blockedUntil).toBeNull();
    expect(third.blockedUntil).toEqual(blockedUntil);
    const identityInsert = query.mock.calls.find((call) =>
      call[0].includes("INSERT INTO public.mobflow_auth_security_state") && call[1]?.[0] === "login",
    );
    expect(identityInsert?.[0]).toContain("now() + interval '30 minutes'");
    expect(identityInsert?.[0]).toContain(">= $5");
    expect(identityInsert?.[1]).toEqual(["login", expect.any(String), 30, true, 3]);
  });

  it("records login failures as HMAC-scoped state without persisting raw identifiers", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ failure_count: 1, blocked_until: null }] }));
    const request = new Request("https://preview.mobflow.test/api/mobflow/login", {
      headers: { "x-real-ip": IP, "x-mobflow-device": DEVICE_ID },
    });

    await recordLoginFailure(mockClient(query), request, USERNAME, "12345678000199");

    expect(query).toHaveBeenCalledTimes(5);
    const serializedParams = JSON.stringify(query.mock.calls.map((call) => call[1]));
    expect(serializedParams).not.toContain(USERNAME);
    expect(serializedParams).not.toContain(IP);
    expect(serializedParams).not.toContain(DEVICE_ID);
    expect(serializedParams).not.toContain("12345678000199");
  });

  it("rate limits public endpoints by HMAC-hashed IP and endpoint", async () => {
    const blockedUntil = new Date(Date.now() + 60 * 60 * 1000);
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ failure_count: 11, blocked_until: blockedUntil }] });
    const request = new Request("https://preview.mobflow.test/api/mobflow/signup", {
      headers: { "x-real-ip": IP },
    });

    const status = await enforcePublicRateLimit(mockClient(query), request, "signup-create-company", 10, 60, 60);

    expect(status.blockedUntil).toEqual(blockedUntil);
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
    expect(query).toHaveBeenCalledTimes(2);
    const serializedParams = JSON.stringify(query.mock.calls.map((call) => call[1]));
    expect(serializedParams).not.toContain(IP);
    expect(serializedParams).not.toContain("signup-create-company");
  });


  it("stores detailed login audit metadata and only records coordinates after consent", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const request = new Request("https://preview.mobflow.test/api/mobflow/login", {
      headers: {
        "x-real-ip": IP,
        "x-mobflow-device": DEVICE_ID,
        "user-agent": "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
        "x-vercel-ip-country": "BR",
        "x-vercel-ip-country-region": "SP",
        "x-vercel-ip-city": "Sao%20Paulo",
      },
    });

    await recordLoginAuditEvent(mockClient(query), request, {
      username: USERNAME,
      cnpj: "12345678000199",
      role: "manager",
      eventType: "login_failed",
      success: false,
      httpStatus: 401,
      location: { permission: "granted", latitude: -23.55, longitude: -46.63, accuracy: 18 },
    });

    expect(query).toHaveBeenCalledOnce();
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("mobflow_login_audit_events");
    expect(values).toContain(USERNAME);
    expect(values).toContain(IP);
    expect(values).toContain(DEVICE_ID);
    expect(values).toContain("BR");
    expect(values).toContain("SP");
    expect(values).toContain("Sao Paulo");
    expect(values[15]).toBe("granted");
    expect(values[16]).toBe(-23.55);
    expect(values[17]).toBe(-46.63);
    expect(values[18]).toBe(18);
  });

  it("does not store geolocation coordinates when permission is denied", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const request = new Request("https://preview.mobflow.test/api/mobflow/login", {
      headers: { "x-real-ip": IP, "x-mobflow-device": DEVICE_ID },
    });

    await recordLoginAuditEvent(mockClient(query), request, {
      username: USERNAME,
      role: "pdv",
      eventType: "login_denied",
      success: false,
      httpStatus: 403,
      location: { permission: "denied", latitude: -23.55, longitude: -46.63 },
    });

    const values = query.mock.calls[0]?.[1] as unknown[];
    expect(values[15]).toBe("denied");
    expect(values[16]).toBeNull();
    expect(values[17]).toBeNull();
    expect(values[18]).toBeNull();
  });

  it("accepts Turnstile only when Siteverify succeeds for an allowed hostname", async () => {
    process.env["TURNSTILE_SECRET"] = "unit-test-turnstile-secret";
    process.env["TURNSTILE_HOSTNAMES"] = "preview.mobflow.test,mobflow-pdv-gestao.vercel.app";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      hostname: "preview.mobflow.test",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://preview.mobflow.test/api/mobflow/login");

    await expect(verifyCompanyLoginCaptcha(request, "turnstile-token")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects Turnstile when Siteverify returns another hostname", async () => {
    process.env["TURNSTILE_SECRET"] = "unit-test-turnstile-secret";
    process.env["TURNSTILE_HOSTNAMES"] = "preview.mobflow.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      hostname: "attacker.example",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://preview.mobflow.test/api/mobflow/login");

    await expect(verifyCompanyLoginCaptcha(request, "turnstile-token")).resolves.toBe(false);
  });

  it("does not call Siteverify for a hostname outside the allowlist", async () => {
    process.env["TURNSTILE_SECRET"] = "unit-test-turnstile-secret";
    process.env["TURNSTILE_HOSTNAMES"] = "preview.mobflow.test";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://untrusted.example/api/mobflow/login");

    await expect(verifyCompanyLoginCaptcha(request, "turnstile-token")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shares the manager-password lockout by account across devices", async () => {
    const blockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    const query = vi.fn(async () => ({ rows: [{ failure_count: 3, blocked_until: blockedUntil }] }));

    const status = await checkManagerPasswordLockout(mockClient(query), ACCOUNT_ID);

    expect(status.blockedUntil).toEqual(blockedUntil);
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
    expect(query).toHaveBeenCalledOnce();
  });

  it("writes manager-password failures with an account-scoped audit event", async () => {
    const blockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("RETURNING failure_count")) return { rows: [{ failure_count: 3, blocked_until: blockedUntil }] };
      return { rows: [] };
    });

    const result = await recordManagerPasswordFailure(mockClient(query), ACCOUNT_ID);

    expect(result.blockedUntil).toEqual(blockedUntil);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toContain("manager_password_failed");
    expect(query.mock.calls[1]?.[1]).toContain(ACCOUNT_ID);
  });
});
