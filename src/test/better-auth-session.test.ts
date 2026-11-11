import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { client, connect, getSession } = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const client = { query, release };
  return {
    client,
    connect: vi.fn(async () => client),
    getSession: vi.fn(),
  };
});

vi.mock("@/lib/server/neon", () => ({
  getNeonPool: () => ({ connect }),
}));

vi.mock("@/lib/server/better-auth", () => ({
  getMobFlowBetterAuth: () => ({ api: { getSession } }),
}));

import { beginAuthenticatedTransaction } from "@/lib/server/mobflow-auth";

const USER_ID = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const ACCOUNT_ID = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";

function request() {
  return new Request("https://mobflow.test/api/mobflow/session-context", {
    headers: { cookie: "better-auth.session_token=synthetic-session" },
  });
}

describe("MobFlow Better Auth cookie session bridge", () => {
  const originalProvider = process.env["MOBFLOW_AUTH_PROVIDER"];

  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockReset().mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.companies")) return { rows: [{ subscription_status: "active", subscription_expires_at: null }] };
      if (sql.includes("FROM public.profiles")) {
        return {
          rows: [{
            id: USER_ID,
            username: "teste.manager",
            account_id: ACCOUNT_ID,
            role: "manager",
            active: true,
            display_name: "Teste Manager",
            permissions: {},
          }],
        };
      }
      return { rows: [] };
    });
    client.release.mockReset();
    connect.mockReset().mockResolvedValue(client);
    getSession.mockReset();
    process.env["MOBFLOW_AUTH_PROVIDER"] = "better-auth";
  });

  afterEach(() => {
    if (originalProvider === undefined) delete process.env["MOBFLOW_AUTH_PROVIDER"];
    else process.env["MOBFLOW_AUTH_PROVIDER"] = originalProvider;
  });

  it("authenticates from the Better Auth cookie and derives identity from the Neon profile", async () => {
    getSession.mockResolvedValue({
      session: { id: "synthetic-session" },
      user: { id: USER_ID },
    });

    const req = request();
    const result = await beginAuthenticatedTransaction(req);

    expect(getSession).toHaveBeenCalledWith({ headers: req.headers });
    expect(connect).toHaveBeenCalledOnce();
    expect(result.identity).toMatchObject({
      userId: USER_ID,
      accountId: ACCOUNT_ID,
      role: "manager",
      username: "teste.manager",
    });
    expect(client.query).toHaveBeenCalledWith("SET LOCAL ROLE mobflow_api");
  });

  it("rejects a missing Better Auth session before opening a database connection", async () => {
    getSession.mockResolvedValue(null);

    await expect(beginAuthenticatedTransaction(request())).rejects.toMatchObject({
      status: 401,
      code: "invalid_token",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID Better Auth user id before opening a database connection", async () => {
    getSession.mockResolvedValue({
      session: { id: "synthetic-session" },
      user: { id: "unexpected-subject" },
    });

    await expect(beginAuthenticatedTransaction(request())).rejects.toMatchObject({
      status: 401,
      code: "invalid_token",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("maps Better Auth database outages to 503", async () => {
    getSession.mockRejectedValue(new Error("synthetic database outage"));

    await expect(beginAuthenticatedTransaction(request())).rejects.toMatchObject({
      status: 503,
      code: "auth_unavailable",
    });
    expect(connect).not.toHaveBeenCalled();
  });
});
