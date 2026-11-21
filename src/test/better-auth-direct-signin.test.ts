import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const client = { query, release };
  const connect = vi.fn(async () => client);
  const handler = vi.fn();
  const checkLoginSecurity = vi.fn();
  const recordLoginFailure = vi.fn();
  const recordLoginSuccess = vi.fn();
  return { client, connect, handler, checkLoginSecurity, recordLoginFailure, recordLoginSuccess };
});

vi.mock("@/lib/server/neon", () => ({
  getNeonPool: () => ({ connect: mocks.connect }),
}));
vi.mock("@/lib/server/better-auth", () => ({
  getMobFlowBetterAuth: () => ({ handler: mocks.handler }),
}));
vi.mock("@/lib/server/auth-security", () => ({
  checkLoginSecurity: mocks.checkLoginSecurity,
  recordLoginFailure: mocks.recordLoginFailure,
  recordLoginSuccess: mocks.recordLoginSuccess,
  acquireLoginAttemptLock: vi.fn(async () => "test-lock"),
  releaseLoginAttemptLock: vi.fn(async () => undefined),
}));

import { handleAuth } from "@/routes/api/auth/$";

function request() {
  return new Request("https://preview.mobflow.test/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.42" },
    body: JSON.stringify({ email: "teste.manager@accounts.mobflow.local", password: "senha-errada" }),
  });
}

describe("Better Auth direct sign-in security", () => {
  const originalProvider = process.env["MOBFLOW_AUTH_PROVIDER"];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env["MOBFLOW_AUTH_PROVIDER"] = "better-auth";
    mocks.client.query.mockResolvedValue({ rows: [] });
    mocks.connect.mockResolvedValue(mocks.client);
    mocks.handler.mockResolvedValue(new Response(JSON.stringify({ message: "Credenciais inválidas." }), { status: 401 }));
    mocks.checkLoginSecurity.mockResolvedValue({ blockedUntil: null, captchaRequired: false, retryAfterSeconds: 0 });
    mocks.recordLoginFailure.mockResolvedValue({ blockedUntil: null, ipFailures: 1, deviceFailures: 0, companyFailures: 0 });
    mocks.recordLoginSuccess.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalProvider === undefined) delete process.env["MOBFLOW_AUTH_PROVIDER"];
    else process.env["MOBFLOW_AUTH_PROVIDER"] = originalProvider;
  });

  it("blocks direct Better Auth sign-in when the shared account lockout is active", async () => {
    const blockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    mocks.checkLoginSecurity.mockResolvedValue({
      blockedUntil,
      captchaRequired: false,
      retryAfterSeconds: 1800,
    });

    const response = await handleAuth(request());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toMatchObject({ code: "AUTH_LOCKED" });
    expect(mocks.handler).not.toHaveBeenCalled();
    expect(mocks.client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("rejects direct sign-in when IP risk requires the company login challenge", async () => {
    mocks.checkLoginSecurity.mockResolvedValue({
      blockedUntil: null,
      captchaRequired: true,
      retryAfterSeconds: 0,
    });

    const response = await handleAuth(request());
    const body = await response.json();

    expect(response.status).toBe(428);
    expect(body).toMatchObject({ code: "CAPTCHA_REQUIRED" });
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("records a failed direct sign-in in the same shared Neon counters", async () => {
    const req = request();
    const response = await handleAuth(req);

    expect(response.status).toBe(401);
    expect(mocks.checkLoginSecurity).toHaveBeenCalledWith(mocks.client, req, "teste.manager", undefined, true);
    expect(mocks.recordLoginFailure).toHaveBeenCalledWith(mocks.client, req, "teste.manager");
    expect(mocks.client.query).toHaveBeenCalledWith("COMMIT");
  });

  it("clears shared login counters after a successful direct sign-in", async () => {
    mocks.handler.mockResolvedValue(new Response(JSON.stringify({ token: "session" }), { status: 200 }));

    const req = request();
    const response = await handleAuth(req);

    expect(response.status).toBe(200);
    expect(mocks.recordLoginSuccess).toHaveBeenCalledWith(mocks.client, req, "teste.manager");
    expect(mocks.recordLoginFailure).not.toHaveBeenCalled();
  });
});
