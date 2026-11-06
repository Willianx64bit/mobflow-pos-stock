import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { client, connect } = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const client = { query, release };
  return { client, connect: vi.fn(async () => client) };
});

vi.mock("@/lib/server/neon", () => ({
  getNeonPool: () => ({ connect }),
}));

import { ApiAuthError, beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";

const USER_ID = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const ACCOUNT_ID = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";

function request(token?: string) {
  return new Request("https://mobflow.test/api/mobflow/session-context", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    username: "teste.manager",
    account_id: ACCOUNT_ID,
    role: "manager",
    active: true,
    display_name: "Teste Manager",
    permissions: {},
    ...overrides,
  };
}

describe("MobFlow Neon API authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    client.query.mockReset();
    client.release.mockReset();
    connect.mockReset().mockResolvedValue(client);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a request without a bearer token before contacting either service", async () => {
    await expect(beginAuthenticatedTransaction(request())).rejects.toMatchObject({
      status: 401,
      code: "missing_token",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects an invalid Supabase session without opening a Neon connection", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 401 }));

    await expect(beginAuthenticatedTransaction(request("expired-token"))).rejects.toMatchObject({
      status: 401,
      code: "invalid_token",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("rolls back and releases the connection when the profile is not migrated", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: USER_ID }));
    client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    await expect(beginAuthenticatedTransaction(request("valid-token"))).rejects.toMatchObject({
      status: 403,
      code: "profile_not_migrated",
    });

    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(2, "SET LOCAL ROLE mobflow_api");
    expect(client.query).toHaveBeenNthCalledWith(3, "SELECT set_config('app.user_id', $1, true)", [USER_ID]);
    expect(client.query).toHaveBeenNthCalledWith(5, "ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects inactive profiles and rolls back", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: USER_ID }));
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [profile({ active: false })] });

    await expect(beginAuthenticatedTransaction(request("valid-token"))).rejects.toMatchObject({
      status: 403,
      code: "profile_inactive",
    });
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.query).toHaveBeenCalledTimes(5);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("sets transaction-local identity context for an active manager", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: USER_ID }));
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [profile()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await beginAuthenticatedTransaction(request("valid-token"));

    expect(result.identity).toEqual({
      userId: USER_ID,
      accountId: ACCOUNT_ID,
      role: "manager",
      username: "teste.manager",
      displayName: "Teste Manager",
      permissions: {},
    });
    expect(client.query).toHaveBeenNthCalledWith(5, "SELECT set_config('app.account_id', $1, true)", [ACCOUNT_ID]);
    expect(client.query).toHaveBeenNthCalledWith(6, "SELECT set_config('app.role', $1, true)", ["manager"]);
    expect(client.release).not.toHaveBeenCalled();
  });


  it("maps Supabase Auth outages to 503 without opening a Neon connection", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 503 }));

    await expect(beginAuthenticatedTransaction(request("valid-token"))).rejects.toMatchObject({
      status: 503,
      code: "auth_unavailable",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects a successful Auth response without a valid user UUID", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: "not-a-uuid" }));

    await expect(beginAuthenticatedTransaction(request("valid-token"))).rejects.toMatchObject({
      status: 401,
      code: "invalid_token",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects unsupported database roles and releases the transaction", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: USER_ID }));
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [profile({ role: "owner" })] });

    await expect(beginAuthenticatedTransaction(request("valid-token"))).rejects.toMatchObject({
      status: 403,
      code: "invalid_role",
    });
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("derives tenant and role from the Neon profile, not request payload fields", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: USER_ID }));
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [profile({ account_id: ACCOUNT_ID, role: "manager" })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const forgedRequest = new Request("https://mobflow.test/api/mobflow/session-context", {
      method: "POST",
      headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
      body: JSON.stringify({ userId: "attacker", accountId: "other-tenant", role: "admin", permissions: ["*"] }),
    });

    const result = await beginAuthenticatedTransaction(forgedRequest);
    expect(result.identity.userId).toBe(USER_ID);
    expect(result.identity.accountId).toBe(ACCOUNT_ID);
    expect(result.identity.role).toBe("manager");
    expect(client.query).toHaveBeenNthCalledWith(5, "SELECT set_config('app.account_id', $1, true)", [ACCOUNT_ID]);
    expect(client.query).toHaveBeenNthCalledWith(6, "SELECT set_config('app.role', $1, true)", ["manager"]);
  });

  it("maps authentication errors to their intended HTTP response", () => {
    const response = jsonError(new ApiAuthError("Sessão ausente.", 401, "missing_token"));
    expect(response.status).toBe(401);
  });
});
