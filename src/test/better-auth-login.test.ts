import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const { client, connect } = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const client = { query, release };
  return { client, connect: vi.fn(async () => client) };
});

vi.mock("@/lib/server/neon", () => ({
  getNeonPool: () => ({ connect }),
}));

vi.mock("@/lib/server/auth-security", () => ({
  checkLoginSecurity: vi.fn(async () => ({ blockedUntil: null, captchaRequired: false, retryAfterSeconds: 0 })),
  recordLoginFailure: vi.fn(async () => ({ blockedUntil: null, ipFailures: 0, deviceFailures: 0, companyFailures: 0 })),
  recordLoginSuccess: vi.fn(async () => undefined),
  verifyCompanyLoginCaptcha: vi.fn(async () => true),
}));

import { handleMobFlowLogin } from "@/routes/api/mobflow/login";

const USER_ID = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const ACCOUNT_ID = USER_ID;
const PROFILE = {
  id: USER_ID,
  username: "TESTE.MANAGER",
  cnpj: "12345678900000",
  account_id: ACCOUNT_ID,
  role: "manager",
  active: true,
  display_name: "Teste Manager",
  permissions: ["PDV", "Gerência"],
};

function request(password = "senha-correta", expectedRole = "manager") {
  return new Request("https://mobflow.test/api/mobflow/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "teste.manager",
      password,
      cnpj: "12.345.678/9000-00",
      expectedRole,
    }),
  });
}

describe("MobFlow Better Auth login validation", () => {
  const originalProvider = process.env["MOBFLOW_AUTH_PROVIDER"];
  let passwordHash: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env["MOBFLOW_AUTH_PROVIDER"] = "better-auth";
    passwordHash = await bcrypt.hash("senha-correta", 4);
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("mobflow_find_login_profile")) return { rows: [PROFILE] };
      if (sql.includes("FROM public.companies")) return { rows: [{ subscription_status: "active", subscription_expires_at: null }] };
      if (sql.includes("mobflow_is_first_manager_login")) return { rows: [{ first_manager_login: false }] };
      if (sql.includes("FROM public.profiles") && sql.includes("role='pdv'")) return { rows: [] };
      if (sql.includes("mobflow_get_login_credential")) return { rows: [{ password: passwordHash }] };
      return { rows: [] };
    });
    client.release.mockReset();
    connect.mockReset().mockResolvedValue(client);
  });

  afterEach(() => {
    if (originalProvider === undefined) delete process.env["MOBFLOW_AUTH_PROVIDER"];
    else process.env["MOBFLOW_AUTH_PROVIDER"] = originalProvider;
  });

  it("validates a manager password, CNPJ and active subscription", async () => {
    const response = await handleMobFlowLogin(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      firstManagerLogin: false,
      profile: { username: "TESTE.MANAGER", role: "manager", account_id: ACCOUNT_ID },
    });
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects an incorrect password without creating a session", async () => {
    const response = await handleMobFlowLogin(request("senha-errada"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ ok: false, error: "Usuário ou senha inválido." });
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("blocks access when the company subscription is inactive", async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("mobflow_find_login_profile")) return { rows: [PROFILE] };
      if (sql.includes("FROM public.companies")) return { rows: [{ subscription_status: "suspended", subscription_expires_at: null }] };
      return { rows: [] };
    });

    const response = await handleMobFlowLogin(request());
    expect(response.status).toBe(403);
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('FROM public."account"'), expect.anything());
  });

  it("validates an active PDV operator with the correct company and operator role", async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("mobflow_find_login_profile")) {
        return { rows: [{ ...PROFILE, role: "pdv", permissions: ["PDV", "Conferência"] }] };
      }
      if (sql.includes("FROM public.companies")) return { rows: [{ subscription_status: "active", subscription_expires_at: null }] };
      if (sql.includes("mobflow_get_login_credential")) return { rows: [{ password: passwordHash }] };
      return { rows: [] };
    });

    const response = await handleMobFlowLogin(request("senha-correta", "pdv"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      profile: {
        username: "TESTE.MANAGER",
        role: "pdv",
        account_id: ACCOUNT_ID,
        permissions: ["PDV", "Conferência"],
      },
    });
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("creates the first manager only when the username and CNPJ are allowlisted", async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("mobflow_find_login_profile")) return { rows: [] };
      if (sql.includes("FROM public.account_allowlist")) return { rows: [{ "?column?": 1 }] };
      if (sql.includes("FROM public.profiles") && sql.includes("WHERE cnpj")) return { rows: [] };
      return { rows: [] };
    });

    const response = await handleMobFlowLogin(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, firstManagerLogin: true, profile: { role: "manager" } });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO public."user"'), expect.any(Array));
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO public."account"'), expect.any(Array));
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO public.profiles"), expect.any(Array));
  });
});
