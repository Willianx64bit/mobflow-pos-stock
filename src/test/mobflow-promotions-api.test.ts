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
  ApiAuthError: class ApiAuthError extends Error {},
}));
vi.mock("@/lib/server/neon", () => ({ releaseTransaction }));

import { Route } from "@/routes/api/mobflow/promotions";

const handlers = (Route as unknown as {
  server: { handlers: Record<string, (args: { request: Request }) => Promise<Response>> };
}).server.handlers;

const tenant = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const promotion = {
  id: "promo-1", product_id: "product-1", product_name_snapshot: "Arroz",
  original_price: "12.50", promo_price: "9.99",
  starts_at: "2026-11-11T10:00:00.000Z", ends_at: "2026-11-12T10:00:00.000Z",
  version: "2", updated_at: "2026-11-11T09:00:00.000Z",
};
const ready = { rows: [{ p: "promotions", e: "mobflow_sync_events", fn: "mobflow_append_sync_event" }] };
const request = (method: string, body?: unknown) => new Request("https://mobflow.test/api/mobflow/promotions", {
  method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const json = (response: Response) => response.json() as Promise<Record<string, any>>;

describe("MobFlow promotions Neon API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("MOBFLOW_AUTH_PROVIDER", "better-auth");
    beginAuthenticatedTransaction.mockResolvedValue({
      client,
      identity: { userId: "user-a", accountId: tenant, role: "manager", permissions: ["Gerência"] },
    });
    releaseTransaction.mockResolvedValue(undefined);
  });

  it("loads only the authenticated tenant's promotions and event history", async () => {
    client.query
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ rows: [promotion] })
      .mockResolvedValueOnce({ rows: [{ event_id: "event-1", sequence: "8", entity_id: "promo-1", payload: { operation: "update", version: 2 }, created_at: promotion.updated_at }] });

    const response = await handlers.GET({ request: request("GET") });
    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({
      ok: true,
      promotions: [{ id: "promo-1", version: 2 }],
      events: [{ event_id: "event-1", sequence: "8", entity_id: "promo-1", payload: { operation: "update", version: 2 } }],
    });
    expect(client.query).toHaveBeenNthCalledWith(2, expect.stringContaining("WHERE tenant_id=$1"), [tenant]);
    expect(client.query).toHaveBeenNthCalledWith(3, expect.stringContaining("category='promotions'"), [tenant]);
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("creates a promotion and appends its version-1 event in the same transaction", async () => {
    client.query
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ rows: [{ name: "Arroz", price: "12.50" }] })
      .mockResolvedValueOnce({ rows: [{ ...promotion, version: "1" }] })
      .mockResolvedValueOnce({ rows: [{ sequence: "9" }] });

    const response = await handlers.POST({ request: request("POST", {
      id: "promo-1", productId: "product-1", promoPrice: 9.99,
      startsAt: promotion.starts_at, endsAt: promotion.ends_at,
    }) });
    expect(response.status).toBe(201);
    await expect(json(response)).resolves.toMatchObject({
      ok: true, promotion: { id: "promo-1", version: 1, eventId: expect.any(String) },
      event: { sequence: "9", eventId: expect.any(String) },
    });
    expect(client.query).toHaveBeenNthCalledWith(4, expect.stringContaining("mobflow_append_sync_event"),
      [expect.any(String), expect.any(String), "promo-1", expect.any(String)]);
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("increments the version and records an update event", async () => {
    client.query
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ rows: [promotion] })
      .mockResolvedValueOnce({ rows: [{ name: "Arroz", price: "12.50" }] })
      .mockResolvedValueOnce({ rows: [{ ...promotion, version: "3" }] })
      .mockResolvedValueOnce({ rows: [{ sequence: "10" }] });

    const response = await handlers.PATCH({ request: request("PATCH", {
      id: "promo-1", expectedVersion: 2, productId: "product-1", promoPrice: 8.99,
      startsAt: promotion.starts_at, endsAt: promotion.ends_at,
    }) });
    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({
      ok: true, promotion: { id: "promo-1", version: 3 },
      event: { sequence: "10", eventId: expect.any(String) },
    });
    expect(client.query).toHaveBeenNthCalledWith(4, expect.stringContaining("version=version+1"),
      [tenant, "promo-1", "product-1", "Arroz", 12.5, 8.99, promotion.starts_at, promotion.ends_at, 2]);
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("records a versioned tombstone when a promotion is deleted", async () => {
    client.query
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ rows: [promotion] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ sequence: "11" }] });

    const response = await handlers.DELETE({ request: request("DELETE", { id: "promo-1", expectedVersion: 2 }) });
    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({
      ok: true, deleted: true, event: { sequence: "11", eventId: expect.any(String) },
    });
    expect(client.query).toHaveBeenNthCalledWith(4, expect.stringContaining("mobflow_append_sync_event"),
      [expect.any(String), expect.any(String), "promo-1", expect.any(String)]);
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("rejects stale edits without writing an event", async () => {
    client.query
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({ rows: [promotion] });
    const response = await handlers.PATCH({ request: request("PATCH", {
      id: "promo-1", expectedVersion: 1, productId: "product-1", promoPrice: 8.99,
      startsAt: promotion.starts_at, endsAt: promotion.ends_at,
    }) });
    expect(response.status).toBe(409);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });

  it("rejects writes from users without promotion-management permission", async () => {
    beginAuthenticatedTransaction.mockResolvedValue({
      client, identity: { userId: "user-a", accountId: tenant, role: "pdv", permissions: [] },
    });
    client.query.mockResolvedValueOnce(ready);
    const response = await handlers.POST({ request: request("POST", {}) });
    expect(response.status).toBe(403);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });
});
