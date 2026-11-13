import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { client, beginAuthenticatedTransaction, releaseTransaction } = vi.hoisted(() => {
  const query = vi.fn();
  const client = { query, release: vi.fn() };
  return {
    client,
    beginAuthenticatedTransaction: vi.fn(),
    releaseTransaction: vi.fn(async (_client: unknown, _commit: boolean) => undefined),
  };
});

vi.mock("@/lib/server/mobflow-auth", () => ({
  beginAuthenticatedTransaction,
  jsonError: (error: unknown) => Response.json({ ok: false, error: String(error) }, { status: 500 }),
}));
vi.mock("@/lib/server/neon", () => ({ releaseTransaction }));

import { handleMobFlowReceiving } from "@/routes/api/mobflow/receiving";

const ACCOUNT_ID = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const baseState = () => ({
  products: [{ id: "product-a", stock: 10 }, { id: "product-b", stock: 4 }],
  receiving: [{
    id: "note-1",
    number: "NF-100",
    supplier: "Fornecedor Teste",
    status: "analisando",
    decisionCompleted: false,
    stockReleased: false,
    items: [{ productId: "product-a", received: 3 }],
    extras: [{ productId: "product-b", received: 2 }],
    decisions: {},
  }],
});
const baseRelationalProducts = () => [
  { id: "product-a", code: "A-01", name: "Produto A", unit: "un" as const, cost: "2.50", stock: "10", active: true },
  { id: "product-b", code: "B-01", name: "Produto B", unit: "un" as const, cost: "4.00", stock: "4", active: true },
];

function request(action: string, decisions?: Record<string, string>) {
  return new Request("https://mobflow.test/api/mobflow/receiving", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, receivingId: "note-1", decisions }),
  });
}

describe("Neon receiving stock release", () => {
  const originalProvider = process.env["MOBFLOW_AUTH_PROVIDER"];
  let state: ReturnType<typeof baseState>;
  let relationalProducts: ReturnType<typeof baseRelationalProducts>;
  let movementInserts: unknown[][];
  let stockUpdates: unknown[][];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env["MOBFLOW_AUTH_PROVIDER"] = "better-auth";
    state = baseState();
    relationalProducts = baseRelationalProducts();
    movementInserts = [];
    stockUpdates = [];
    client.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT state FROM public.app_state")) return { rows: [{ state }] };
      if (sql.includes("FROM public.products") && sql.includes("FOR UPDATE")) {
        const ids = params[1] as string[];
        return { rows: relationalProducts.filter((product) => ids.includes(product.id)) };
      }
      if (sql.includes("UPDATE public.products")) {
        stockUpdates.push(params);
        const product = relationalProducts.find((item) => item.id === params[1]);
        if (product) product.stock = String(params[2]);
        return { rows: [], rowCount: product ? 1 : 0 };
      }
      if (sql.includes("INSERT INTO public.stock_movements")) {
        movementInserts.push(params);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE public.app_state")) return { rows: [], rowCount: 1 };
      return { rows: [] };
    });
    beginAuthenticatedTransaction.mockResolvedValue({
      client,
      identity: {
        userId: ACCOUNT_ID, accountId: ACCOUNT_ID, role: "manager",
        permissions: ["Gerência"], username: "gerente", displayName: "Gerente",
      },
    });
  });

  afterEach(() => {
    if (originalProvider === undefined) delete process.env["MOBFLOW_AUTH_PROVIDER"];
    else process.env["MOBFLOW_AUTH_PROVIDER"] = originalProvider;
  });

  it("adds only accepted quantities to relational stock and records a realtime ledger movement", async () => {
    const response = await handleMobFlowReceiving(request("finalize_decisions", {
      "product-a": "aceitar",
      "product-b": "devolver",
    }));
    const body = await response.json();
    const updateCall = client.query.mock.calls.find((call) => String(call[0]).includes("UPDATE public.app_state"));
    const saved = JSON.parse(updateCall?.[1]?.[1] as string);

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: true });
    expect(relationalProducts.map((product) => [product.id, product.stock])).toEqual([
      ["product-a", "13"], ["product-b", "4"],
    ]);
    expect(stockUpdates).toHaveLength(1);
    expect(movementInserts).toHaveLength(1);
    expect(movementInserts[0]![0]).toBe(ACCOUNT_ID);
    expect(movementInserts[0]![1]).toBe("note-1:product-a");
    expect(movementInserts[0]![2]).toBe("note-1");
    expect(movementInserts[0]![4]).toBe("product-a");
    expect(movementInserts[0]![8]).toBe(3);
    expect(movementInserts[0]![9]).toBe(7.5);
    expect(movementInserts[0]![10]).toBe(10);
    expect(movementInserts[0]![11]).toBe(13);
    expect(movementInserts[0]![12]).toBe(3);
    expect(movementInserts[0]![15]).toBe("Nota NF-100 · Fornecedor Teste");
    expect(saved.products).toEqual([{ id: "product-a", stock: 13 }, { id: "product-b", stock: 4 }]);
    expect(saved.receiving[0]).toMatchObject({
      decisions: { "product-a": "aceitar", "product-b": "devolver" },
      decisionCompleted: true,
      status: "aceito",
      stockReleased: true,
    });

    const eventCalls = client.query.mock.calls.filter((call) =>
      String(call[0]).includes("mobflow_append_sync_event"),
    );
    expect(eventCalls).toHaveLength(2);
    expect(eventCalls[0]![0]).toContain("'receiving', 'automatic'");
    expect(eventCalls[1]![0]).toContain("'stock', 'automatic'");
    expect(eventCalls[1]![1][2]).toBe("product-a");
    expect(JSON.parse(eventCalls[1]![1][3] as string)).toMatchObject({
      operationId: "note-1", operationType: "receiving",
      stockDelta: 3, delta: 3, stockBefore: 10, stockAfter: 13,
      quantity: 3, source: "receiving",
    });
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("aggregates accepted lines for the same product and excludes returned lines", async () => {
    state.receiving[0]!.items = [
      { productId: "product-a", received: 3 },
      { productId: "product-a", received: 2 },
    ];
    state.receiving[0]!.extras = [{ productId: "product-b", received: 7 }];
    const response = await handleMobFlowReceiving(request("finalize_decisions", {
      "product-a": "aceitar", "product-b": "devolver",
    }));

    expect(response.status).toBe(200);
    expect(relationalProducts[0]!.stock).toBe("15");
    expect(relationalProducts[1]!.stock).toBe("4");
    expect(movementInserts).toHaveLength(1);
    expect(movementInserts[0]![8]).toBe(5);
  });

  it("does not release stock when a decision is missing", async () => {
    const response = await handleMobFlowReceiving(request("finalize_decisions", { "product-a": "aceitar" }));
    expect(await response.json()).toEqual({ ok: true, data: false });
    expect(stockUpdates).toHaveLength(0);
    expect(movementInserts).toHaveLength(0);
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE public.app_state"), expect.anything());
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });

  it("rolls back when the authoritative relational stock is invalid", async () => {
    relationalProducts[0]!.stock = "not-a-number";
    const response = await handleMobFlowReceiving(request("finalize_decisions", {
      "product-a": "aceitar", "product-b": "devolver",
    }));

    expect(response.status).toBe(500);
    expect(movementInserts).toHaveLength(0);
    expect(client.query.mock.calls.some((call) => String(call[0]).includes("mobflow_append_sync_event"))).toBe(false);
    expect(client.query.mock.calls.some((call) => String(call[0]).includes("UPDATE public.app_state"))).toBe(false);
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });

  it("rejects fractional quantities for unit products without writing stock", async () => {
    state.receiving[0]!.items[0]!.received = 1.5;
    const response = await handleMobFlowReceiving(request("finalize_decisions", {
      "product-a": "aceitar", "product-b": "devolver",
    }));

    expect(response.status).toBe(400);
    expect(stockUpdates).toHaveLength(0);
    expect(movementInserts).toHaveLength(0);
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });

  it("accepts a completed decision and releases stock once", async () => {
    state.receiving[0]!.decisionCompleted = true;
    state.receiving[0]!.decisions = { "product-a": "aceitar", "product-b": "devolver" };
    const response = await handleMobFlowReceiving(request("accept"));
    const body = await response.json();

    expect(body).toEqual({ ok: true, data: true });
    expect(relationalProducts[0]!.stock).toBe("13");
    expect(relationalProducts[1]!.stock).toBe("4");
    expect(movementInserts).toHaveLength(1);
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("records the return action as completed without changing stock", async () => {
    state.receiving[0]!.stockReleased = true;
    state.receiving[0]!.decisionCompleted = true;
    state.receiving[0]!.decisions = { "product-a": "aceitar", "product-b": "devolver" };
    const response = await handleMobFlowReceiving(request("complete_action"));
    const body = await response.json();
    const updateCall = client.query.mock.calls.find((call) => String(call[0]).includes("UPDATE public.app_state"));
    const saved = JSON.parse(updateCall?.[1]?.[1] as string);
    const eventCalls = client.query.mock.calls.filter((call) => String(call[0]).includes("mobflow_append_sync_event"));

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: true });
    expect(saved.receiving[0]).toMatchObject({ stockReleased: true, actionCompleted: true });
    expect(stockUpdates).toHaveLength(0);
    expect(movementInserts).toHaveLength(0);
    expect(eventCalls).toHaveLength(1);
    expect(eventCalls[0]![0]).toContain("'receiving','automatic'");
    expect(JSON.parse(eventCalls[0]![1][3] as string)).toEqual({
      operation: "action_completed", actionCompleted: true,
    });
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("treats a repeated action completion as a no-op", async () => {
    state.receiving[0]!.stockReleased = true;
    state.receiving[0]!.actionCompleted = true;
    state.receiving[0]!.decisions = { "product-a": "aceitar", "product-b": "devolver" };
    const response = await handleMobFlowReceiving(request("complete_action"));

    expect(await response.json()).toEqual({ ok: true, data: true });
    expect(stockUpdates).toHaveLength(0);
    expect(movementInserts).toHaveLength(0);
    expect(client.query.mock.calls.some((call) => String(call[0]).includes("UPDATE public.app_state"))).toBe(false);
    expect(client.query.mock.calls.some((call) => String(call[0]).includes("mobflow_append_sync_event"))).toBe(false);
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });

  it("does not append or apply stock movements when the same receiving is accepted again", async () => {
    state.receiving[0]!.decisionCompleted = true;
    state.receiving[0]!.decisions = { "product-a": "aceitar", "product-b": "devolver" };
    state.receiving[0]!.stockReleased = true;
    state.products[0]!.stock = 13;
    relationalProducts[0]!.stock = "13";

    const response = await handleMobFlowReceiving(request("accept"));

    expect(await response.json()).toEqual({ ok: true, data: false });
    expect(stockUpdates).toHaveLength(0);
    expect(movementInserts).toHaveLength(0);
    expect(client.query.mock.calls.some((call) => String(call[0]).includes("mobflow_append_sync_event"))).toBe(false);
    expect(client.query.mock.calls.some((call) => String(call[0]).includes("UPDATE public.app_state"))).toBe(false);
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });
});
