import { beforeEach, describe, expect, it, vi } from "vitest";

const { client, beginAuthenticatedTransaction, releaseTransaction } = vi.hoisted(() => ({
  client: { query: vi.fn() },
  beginAuthenticatedTransaction: vi.fn(),
  releaseTransaction: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
}));

vi.mock("@/lib/server/mobflow-auth", () => ({
  beginAuthenticatedTransaction,
  jsonError: () => Response.json(
    { ok: false, code: "internal_error" },
    { status: 500 },
  ),
}));

vi.mock("@/lib/server/neon", () => ({ releaseTransaction }));

import { Route } from "@/routes/api/mobflow/state";

const handlers = (Route as unknown as {
  server: {
    handlers: {
      GET: (args: { request: Request }) => Promise<Response>;
      PUT: (args: { request: Request }) => Promise<Response>;
    };
  };
}).server.handlers;

const ACCOUNT_ID = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const VERSION_1 = "2026-11-06T18:00:00.000Z";
const VERSION_2 = "2026-11-06T18:00:01.000Z";

function put(body: string) {
  return new Request("https://mobflow.test/api/mobflow/state", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });
}

function transaction() {
  beginAuthenticatedTransaction.mockResolvedValue({
    client,
    identity: { userId: ACCOUNT_ID, accountId: ACCOUNT_ID, role: "manager" },
  });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("MobFlow Neon state API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaction();
    releaseTransaction.mockResolvedValue(undefined);
  });

  it("reads the state and version for the authenticated account", async () => {
    client.query.mockResolvedValueOnce({
      rows: [{ state: { products: [{ id: "p1", quantity: 4 }] }, updated_at: VERSION_1 }],
    });

    const response = await handlers.GET({ request: new Request("https://mobflow.test/api/mobflow/state") });

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({
      ok: true,
      state: { products: [{ id: "p1", quantity: 4 }] },
      updatedAt: VERSION_1,
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("to_char(updated_at AT TIME ZONE 'UTC'"),
      [ACCOUNT_ID],
    );
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("creates the first state when no expected version is supplied", async () => {
    client.query.mockResolvedValueOnce({ rows: [{ updated_at: VERSION_1 }] });

    const response = await handlers.PUT({ request: put(JSON.stringify({ state: { products: [] } })) });

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({ ok: true, status: "saved", updatedAt: VERSION_1 });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO public.app_state"),
      [ACCOUNT_ID, JSON.stringify({ products: [] })],
    );
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("updates state only when the expected timestamp matches", async () => {
    client.query
      .mockResolvedValueOnce({ rows: [{ state: { products: [{ id: "p1", quantity: 4 }] } }] })
      .mockResolvedValueOnce({ rows: [{ updated_at: VERSION_2 }] });

    const response = await handlers.PUT({
      request: put(JSON.stringify({ state: { products: [{ id: "p1", quantity: 8 }] }, expectedUpdatedAt: VERSION_1 })),
    });

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({ ok: true, status: "saved", updatedAt: VERSION_2 });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE owner_id = $2"),
      [JSON.stringify({ products: [{ id: "p1", quantity: 8 }] }), ACCOUNT_ID, VERSION_1],
    );
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("preserves PostgreSQL microsecond precision in the returned version", async () => {
    const preciseVersion = "2026-11-06T22:00:00.000001Z";
    client.query
      .mockResolvedValueOnce({ rows: [{ state: { products: [] } }] })
      .mockResolvedValueOnce({ rows: [{ updated_at: preciseVersion }] });

    const response = await handlers.PUT({
      request: put(JSON.stringify({ state: { products: [] }, expectedUpdatedAt: VERSION_1 })),
    });

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toMatchObject({
      ok: true,
      status: "saved",
      updatedAt: preciseVersion,
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("to_char(updated_at AT TIME ZONE 'UTC'"),
      [JSON.stringify({ products: [] }), ACCOUNT_ID, VERSION_1],
    );
  });


  it("appends automatic stock and price events only for valid changed numeric values", async () => {
    const previousState = { products: [
      { id: "p1", stock: 10, price: 5 },
      { id: "p2", stock: null, price: null },
    ] };
    const nextState = { products: [
      { id: "p1", stock: 8, price: 6 },
      { id: "p2", stock: 3, price: 4 },
    ] };
    client.query
      .mockResolvedValueOnce({ rows: [{ state: previousState }] })
      .mockResolvedValueOnce({ rows: [{ updated_at: VERSION_2 }] })
      .mockResolvedValue({ rows: [] });

    const response = await handlers.PUT({
      request: put(JSON.stringify({ state: nextState, expectedUpdatedAt: VERSION_1 })),
    });

    expect(response.status).toBe(200);
    const eventCalls = client.query.mock.calls.filter((call) =>
      String(call[0]).includes("mobflow_append_sync_event"),
    );
    expect(eventCalls).toHaveLength(2);
    expect(eventCalls[0][0]).toContain("'stock', 'automatic'");
    expect(eventCalls[0][1][2]).toBe("p1");
    expect(JSON.parse(eventCalls[0][1][3] as string)).toMatchObject({
      stockDelta: -2, resultingStock: 8, source: "state_update",
    });
    expect(eventCalls[1][0]).toContain("'price', 'automatic'");
    expect(eventCalls[1][1][2]).toBe("p1");
    expect(JSON.parse(eventCalls[1][1][3] as string)).toMatchObject({
      price: 6, previousPrice: 5, source: "state_update",
    });
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("emits manual catalog upsert and delete events without photo data", async () => {
    const previousState = { products: [
      { id: "old", code: "001", name: "Antigo", photo: "data:image/png;base64,secret" },
    ] };
    const nextState = { products: [
      { id: "new", code: "002", name: "Novo", photo: "data:image/png;base64,private" },
    ] };
    client.query
      .mockResolvedValueOnce({ rows: [{ state: previousState }] })
      .mockResolvedValueOnce({ rows: [{ updated_at: VERSION_2 }] })
      .mockResolvedValue({ rows: [] });

    const response = await handlers.PUT({
      request: put(JSON.stringify({ state: nextState, expectedUpdatedAt: VERSION_1 })),
    });

    expect(response.status).toBe(200);
    const events = client.query.mock.calls.filter((call) =>
      String(call[0]).includes("mobflow_append_sync_event"),
    );
    expect(events).toHaveLength(2);
    expect(events[0][0]).toContain("'catalog', 'manual'");
    expect(events[0][1][2]).toBe("new");
    expect(JSON.parse(events[0][1][3] as string)).toMatchObject({
      operation: "upsert", product: { code: "002", name: "Novo" },
    });
    expect(JSON.parse(events[0][1][3] as string)).not.toHaveProperty("product.photo");
    expect(events[1][1][2]).toBe("old");
    expect(JSON.parse(events[1][1][3] as string)).toEqual({ operation: "delete" });
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("emits a manual catalog upsert when catalog metadata changes", async () => {
    const previousState = { products: [{ id: "p1", code: "001", name: "Produto", category: "Mercearia" }] };
    const nextState = { products: [{ id: "p1", code: "001", name: "Produto atualizado", category: "Limpeza" }] };
    client.query
      .mockResolvedValueOnce({ rows: [{ state: previousState }] })
      .mockResolvedValueOnce({ rows: [{ updated_at: VERSION_2 }] })
      .mockResolvedValue({ rows: [] });

    const response = await handlers.PUT({
      request: put(JSON.stringify({ state: nextState, expectedUpdatedAt: VERSION_1 })),
    });

    expect(response.status).toBe(200);
    const events = client.query.mock.calls.filter((call) =>
      String(call[0]).includes("mobflow_append_sync_event"),
    );
    expect(events).toHaveLength(1);
    expect(events[0][0]).toContain("'catalog', 'manual'");
    expect(events[0][1][2]).toBe("p1");
    expect(JSON.parse(events[0][1][3] as string)).toMatchObject({
      operation: "upsert",
      product: { name: "Produto atualizado", category: "Limpeza" },
    });
  });

  it("emits manual promotion upsert and delete events with a limited projection", async () => {
    const previousState = {
      promotions: [{ id: "promo-old", productId: "p1", productName: "Arroz", originalPrice: 20, promoPrice: 18, startsAt: "2026-11-01", endsAt: "2026-11-10" }],
      settings: { pixKey: "must-not-be-in-event" },
    };
    const nextState = {
      promotions: [{ id: "promo-new", productId: "p2", productName: "Feijão", originalPrice: 12, promoPrice: 10, startsAt: "2026-11-07", endsAt: "2026-11-14" }],
      settings: { pixKey: "must-not-be-in-event" },
    };
    client.query
      .mockResolvedValueOnce({ rows: [{ state: previousState }] })
      .mockResolvedValueOnce({ rows: [{ updated_at: VERSION_2 }] })
      .mockResolvedValue({ rows: [] });

    const response = await handlers.PUT({
      request: put(JSON.stringify({ state: nextState, expectedUpdatedAt: VERSION_1 })),
    });

    expect(response.status).toBe(200);
    const events = client.query.mock.calls.filter((call) =>
      String(call[0]).includes("mobflow_append_sync_event"),
    );
    expect(events).toHaveLength(2);
    expect(events[0][0]).toContain("'promotions', 'manual'");
    expect(events[0][1][2]).toBe("promo-new");
    const upsertPayload = JSON.parse(events[0][1][3] as string);
    expect(upsertPayload).toMatchObject({
      operation: "upsert",
      promotion: { id: "promo-new", productId: "p2", promoPrice: 10 },
    });
    expect(JSON.stringify(upsertPayload)).not.toContain("must-not-be-in-event");
    expect(events[1][1][2]).toBe("promo-old");
    expect(JSON.parse(events[1][1][3] as string)).toEqual({ operation: "delete" });
  });

  it("does not create stock or price events for unchanged or missing numeric values", async () => {
    const previousState = { products: [{ id: "p1", stock: null, price: undefined }] };
    const nextState = { products: [{ id: "p1", stock: null, price: null }] };
    client.query
      .mockResolvedValueOnce({ rows: [{ state: previousState }] })
      .mockResolvedValueOnce({ rows: [{ updated_at: VERSION_2 }] });

    const response = await handlers.PUT({
      request: put(JSON.stringify({ state: nextState, expectedUpdatedAt: VERSION_1 })),
    });

    expect(response.status).toBe(200);
    expect(client.query.mock.calls.some((call) =>
      String(call[0]).includes("mobflow_append_sync_event"),
    )).toBe(false);
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("returns HTTP 409 and the latest remote state after a stale-version conflict", async () => {
    const remoteState = { products: [{ id: "p1", quantity: 9 }] };
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ state: remoteState, updated_at: VERSION_2 }] });

    const response = await handlers.PUT({
      request: put(JSON.stringify({ state: { products: [{ id: "p1", quantity: 7 }] }, expectedUpdatedAt: VERSION_1 })),
    });

    expect(response.status).toBe(409);
    await expect(json(response)).resolves.toMatchObject({
      ok: false,
      status: "conflict",
      code: "version_conflict",
      remoteState,
      remoteUpdatedAt: VERSION_2,
    });
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
    expect(client.query.mock.calls.some((call) =>
      String(call[0]).includes("mobflow_append_sync_event"),
    )).toBe(false);
  });

  it("allows only one of two concurrent writes using the same version", async () => {
    let updateCount = 0;
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT state") && sql.includes("FOR UPDATE")) {
        return { rows: [{ state: { products: [] } }] };
      }
      if (sql.includes("UPDATE public.app_state")) {
        updateCount += 1;
        return updateCount === 1 ? { rows: [{ updated_at: VERSION_2 }] } : { rows: [] };
      }
      if (sql.includes("SELECT state, to_char")) {
        return { rows: [{ state: { winner: true }, updated_at: VERSION_2 }] };
      }
      return { rows: [] };
    });

    const [first, second] = await Promise.all([
      handlers.PUT({ request: put(JSON.stringify({ state: { writer: "device-a" }, expectedUpdatedAt: VERSION_1 })) }),
      handlers.PUT({ request: put(JSON.stringify({ state: { writer: "device-b" }, expectedUpdatedAt: VERSION_1 })) }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(updateCount).toBe(2);
  });

  it("returns 400 for malformed JSON, null bodies, and non-object state values", async () => {
    const malformed = await handlers.PUT({ request: put("{") });
    const nullBody = await handlers.PUT({ request: put("null") });
    const invalidState = await handlers.PUT({ request: put(JSON.stringify({ state: [] })) });

    expect(malformed.status).toBe(400);
    expect((await json(malformed)).code).toBe("invalid_json");
    expect(nullBody.status).toBe(400);
    expect((await json(nullBody)).code).toBe("invalid_body");
    expect(invalidState.status).toBe(400);
    expect((await json(invalidState)).code).toBe("invalid_state");
    expect(beginAuthenticatedTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid expected version", async () => {
    const response = await handlers.PUT({
      request: put(JSON.stringify({ state: { products: [] }, expectedUpdatedAt: "not-a-date" })),
    });

    expect(response.status).toBe(400);
    await expect(json(response)).resolves.toMatchObject({ code: "invalid_version" });
    expect(beginAuthenticatedTransaction).not.toHaveBeenCalled();
  });

  it("rejects payloads larger than 8 MiB before opening a database transaction", async () => {
    const oversized = JSON.stringify({ state: { data: "x".repeat(8 * 1024 * 1024) } });
    const response = await handlers.PUT({ request: put(oversized) });

    expect(response.status).toBe(413);
    await expect(json(response)).resolves.toMatchObject({ code: "payload_too_large" });
    expect(beginAuthenticatedTransaction).not.toHaveBeenCalled();
  });
});
