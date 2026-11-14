import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  checkLoginSecurity,
  recordLoginFailure,
  checkManagerPasswordLockout,
  recordManagerPasswordFailure,
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

  beforeEach(() => {
    process.env["BETTER_AUTH_SECRET"] = "unit-test-only-secret";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env["BETTER_AUTH_SECRET"];
    else process.env["BETTER_AUTH_SECRET"] = originalSecret;
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

  it("records login failures as HMAC-scoped state without persisting raw identifiers", async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [{ failure_count: 1, blocked_until: null }] }));
    const request = new Request("https://preview.mobflow.test/api/mobflow/login", {
      headers: { "x-real-ip": IP, "x-mobflow-device": DEVICE_ID },
    });

    await recordLoginFailure(mockClient(query), request, USERNAME, "12345678000199");

    expect(query).toHaveBeenCalledTimes(4);
    const serializedParams = JSON.stringify(query.mock.calls.map((call) => call[1]));
    expect(serializedParams).not.toContain(USERNAME);
    expect(serializedParams).not.toContain(IP);
    expect(serializedParams).not.toContain(DEVICE_ID);
    expect(serializedParams).not.toContain("12345678000199");
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
    const query = vi.fn(async (sql: string) => {
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
