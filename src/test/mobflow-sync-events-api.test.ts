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

import { Route } from "@/routes/api/mobflow/sync/events";

const getHandler = (Route as unknown as {
  server: { handlers: { GET: (args: { request: Request }) => Promise<Response> } };
}).server.handlers.GET;

const TENANT_A = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const TENANT_B = "8c47eaac-2abf-4cd6-b614-24e27077bdf6";

function request(query = "") {
  return new Request(`https://mobflow.test/api/mobflow/sync/events${query}`);
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

describe("MobFlow incremental sync event pull API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    beginAuthenticatedTransaction.mockResolvedValue({
      client,
      identity: { userId: "user-a", accountId: TENANT_A, role: "manager" },
    });
    releaseTransaction.mockResolvedValue(undefined);
  });

  it("returns ordered events bounded by the authenticated tenant high-water mark", async () => {
    const rows = [
      { event_id: "e1", sequence: "11", category: "stock", delivery_mode: "automatic", entity_type: "product", entity_id: "p1", payload: { delta: -1 }, created_at: "2026-11-07T12:00:00.000000Z" },
      { event_id: "e2", sequence: "12", category: "price", delivery_mode: "automatic", entity_type: "product", entity_id: "p2", payload: { price: 8 }, created_at: "2026-11-07T12:00:01.000000Z" },
    ];
    client.query
      .mockResolvedValueOnce({ rows: [{ last_sequence: "12" }] })
      .mockResolvedValueOnce({ rows });

    const response = await getHandler({ request: request("?cursor=10&limit=2") });

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({
      ok: true, cursor: "10", nextCursor: "12", highWaterMark: "12", hasMore: false, events: rows,
    });
    expect(client.query).toHaveBeenNthCalledWith(1, expect.stringContaining("mobflow_sync_counters"), [TENANT_A]);
    expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining("sequence > $2::bigint"), [TENANT_A, "10", "12", 3]);
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("advances to the high-water mark after the last event across delivery modes", async () => {
    const rows = [
      { event_id: "e1", sequence: "11", category: "sales", delivery_mode: "automatic", entity_type: "sale", entity_id: "s1", payload: {}, created_at: "2026-11-07T12:00:00.000000Z" },
      { event_id: "e2", sequence: "13", category: "cash", delivery_mode: "automatic", entity_type: "cash_movement", entity_id: "m1", payload: {}, created_at: "2026-11-07T12:00:01.000000Z" },
    ];
    client.query
      .mockResolvedValueOnce({ rows: [{ last_sequence: "17" }] })
      .mockResolvedValueOnce({ rows });
    const response = await getHandler({ request: request("?cursor=10&limit=10") });
    await expect(json(response)).resolves.toMatchObject({
      nextCursor: "17", highWaterMark: "17", hasMore: false, events: rows,
    });
  });

  it("uses the next cursor only through the last returned event when another page exists", async () => {
    client.query
      .mockResolvedValueOnce({ rows: [{ last_sequence: "99" }] })
      .mockResolvedValueOnce({ rows: [
        { sequence: "21" }, { sequence: "22" }, { sequence: "23" },
      ] });

    const response = await getHandler({ request: request("?cursor=20&limit=2") });
    await expect(json(response)).resolves.toMatchObject({
      nextCursor: "22", highWaterMark: "99", hasMore: true, events: [{ sequence: "21" }, { sequence: "22" }],
    });
  });

  it("does not open a transaction for invalid cursors or limits", async () => {
    for (const query of ["?cursor=-1", "?cursor=1.2", "?cursor=abc", "?cursor=9223372036854775808", "?limit=0", "?limit=1.5"]) {
      const response = await getHandler({ request: request(query) });
      expect(response.status).toBe(400);
      await expect(json(response)).resolves.toMatchObject({ code: "invalid_sync_cursor" });
    }
    expect(beginAuthenticatedTransaction).not.toHaveBeenCalled();
  });

  it("caps requested pages at 250 events", async () => {
    client.query
      .mockResolvedValueOnce({ rows: [{ last_sequence: "500" }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await getHandler({ request: request("?cursor=0&limit=999") });
    expect(response.status).toBe(200);
    expect(client.query).toHaveBeenNthCalledWith(2, expect.any(String), [TENANT_A, "0", "500", 251]);
  });

  it("returns manual-only events instead of skipping their payloads", async () => {
    client.query
      .mockResolvedValueOnce({ rows: [{ last_sequence: "50" }] })
      .mockResolvedValueOnce({ rows: [{ event_id: "manual-1", sequence: "25", category: "catalog", delivery_mode: "manual", entity_type: "product", entity_id: "p1", payload: { operation: "upsert" }, created_at: "2026-11-07T12:00:00.000000Z" }] });

    const response = await getHandler({ request: request("?cursor=10") });
    await expect(json(response)).resolves.toMatchObject({
      events: [{ event_id: "manual-1", sequence: "25", delivery_mode: "manual" }], cursor: "10", nextCursor: "50", highWaterMark: "50", hasMore: false,
    });
    expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining("sequence > $2::bigint"), [TENANT_A, "10", "50", 101]);
  });

  it("rolls back and releases the transaction if the event query fails", async () => {
    client.query
      .mockResolvedValueOnce({ rows: [{ last_sequence: "5" }] })
      .mockRejectedValueOnce(new Error("database unavailable"));

    const response = await getHandler({ request: request("?cursor=0") });
    expect(response.status).toBe(500);
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });
});
