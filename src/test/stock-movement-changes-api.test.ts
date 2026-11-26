import { beforeEach, describe, expect, it, vi } from "vitest";

const { client, beginAuthenticatedTransaction, releaseTransaction } = vi.hoisted(() => ({
  client: { query: vi.fn() },
  beginAuthenticatedTransaction: vi.fn(),
  releaseTransaction: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (path: string) => (config: unknown) => ({ path, ...(config as object) }),
}));

vi.mock("@/lib/server/mobflow-auth", () => ({
  beginAuthenticatedTransaction,
  jsonError: () => Response.json({ ok: false, code: "internal_error" }, { status: 500 }),
}));

vi.mock("@/lib/server/neon", () => ({ releaseTransaction }));

import { Route } from "@/routes/api/mobflow/stock-movements/changes";

const getHandler = (Route as unknown as {
  server: { handlers: { GET: (args: { request: Request }) => Promise<Response> } };
}).server.handlers.GET;

const TENANT_A = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";

function request(query = "") {
  return new Request(`https://mobflow.test/api/mobflow/stock-movements/changes${query}`);
}

describe("Stock movement realtime change check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    beginAuthenticatedTransaction.mockResolvedValue({
      client,
      identity: { userId: "user-a", accountId: TENANT_A, role: "manager" },
    });
    releaseTransaction.mockResolvedValue(undefined);
  });

  it("returns only the stock-change flag and the tenant high-water cursor", async () => {
    client.query.mockResolvedValueOnce({
      rows: [{ highWaterMark: "42", hasStockChanges: true }],
    });

    const response = await getHandler({ request: request("?cursor=17") });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      highWaterMark: "42",
      hasStockChanges: true,
    });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("event.category = 'stock'"),
      [TENANT_A, "17"],
    );
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("does not report unrelated price events as stock changes", async () => {
    client.query.mockResolvedValueOnce({
      rows: [{ highWaterMark: "43", hasStockChanges: false }],
    });

    const response = await getHandler({ request: request("?cursor=42") });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      highWaterMark: "43",
      hasStockChanges: false,
    });
  });

  it("rejects invalid cursors before opening a database transaction", async () => {
    for (const cursor of ["-1", "1.5", "abc", "9223372036854775808"]) {
      const response = await getHandler({ request: request(`?cursor=${cursor}`) });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "invalid_stock_movement_cursor",
      });
    }
    expect(beginAuthenticatedTransaction).not.toHaveBeenCalled();
  });
});
