import { beforeEach, describe, expect, it, vi } from "vitest";

const { client, beginAuthenticatedTransaction, releaseTransaction, createRealtime, rawSql, seal } = vi.hoisted(() => ({
  client: { query: vi.fn() },
  beginAuthenticatedTransaction: vi.fn(),
  releaseTransaction: vi.fn(),
  createRealtime: vi.fn(),
  rawSql: vi.fn((sql: string, params: unknown[]) => ({ sql, params })),
  seal: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: unknown) => ({ path, ...(config as object) }),
}));

vi.mock("@neon/realtime/server", () => ({
  createRealtime,
  rawSql,
}));

vi.mock("@/lib/server/mobflow-auth", () => ({
  beginAuthenticatedTransaction,
  jsonError: () => Response.json({ ok: false, code: "internal_error" }, { status: 500 }),
}));

vi.mock("@/lib/server/neon", () => ({ releaseTransaction }));

import { Route } from "@/routes/api/mobflow/sync/live-query";

const postHandler = (Route as unknown as {
  server: { handlers: { POST: (args: { request: Request }) => Promise<Response> } };
}).server.handlers.POST;

const TENANT_A = "37a90cc4-9f12-489f-a622-e604fba92869";
const TENANT_B = "b997fa43-715b-401e-8295-a4827c8903b1";

describe("MobFlow sealed Neon Realtime tenant signal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["NEON_REALTIME_SECRET"] = "test-only-realtime-secret";
    process.env["NEON_DATABASE_URL"] = "postgresql://mobflow_api:test@localhost:5432/mobflow_pdv_clean_start";
    createRealtime.mockReturnValue({ seal });
    seal.mockResolvedValue({ query: "sealed-query", expiresAt: 1_800_000_000_000 });
    beginAuthenticatedTransaction.mockImplementation(async () => ({
      client,
      identity: { userId: "authenticated-profile", accountId: TENANT_A, role: "manager" },
    }));
    releaseTransaction.mockResolvedValue(undefined);
  });

  it("seals only the authenticated tenant's minimal signal query", async () => {
    const response = await postHandler({
      request: new Request("https://mobflow.test/api/mobflow/sync/live-query", { method: "POST" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ query: "sealed-query" });
    expect(createRealtime).toHaveBeenCalledWith({
      secret: "test-only-realtime-secret",
      db: "mobflow_pdv_clean_start",
    });
    expect(rawSql).toHaveBeenCalledWith(
      expect.stringContaining("FROM public.mobflow_realtime_signals"),
      [TENANT_A],
    );
    expect(rawSql.mock.calls[0]?.[0]).toContain("WHERE tenant_id = $1");
    expect(rawSql.mock.calls[0]?.[0]).not.toContain("mobflow_sync_events");
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("uses a different authenticated tenant parameter for another company", async () => {
    beginAuthenticatedTransaction.mockResolvedValueOnce({
      client,
      identity: { userId: "authenticated-profile-b", accountId: TENANT_B, role: "manager" },
    });

    const response = await postHandler({
      request: new Request("https://mobflow.test/api/mobflow/sync/live-query", { method: "POST" }),
    });

    expect(response.status).toBe(200);
    expect(rawSql).toHaveBeenCalledWith(
      expect.stringContaining("WHERE tenant_id = $1"),
      [TENANT_B],
    );
    expect(rawSql.mock.calls[0]?.[1]).not.toContain(TENANT_A);
  });
});
