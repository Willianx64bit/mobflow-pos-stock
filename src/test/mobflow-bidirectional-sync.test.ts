import { describe, expect, it, vi } from "vitest";
import {
  createSyncCommand,
  pullSyncEvents,
  runIncrementalSync,
  type SyncEvent,
  type SyncOutbox,
} from "@/lib/sync-outbox";
import { applySyncEventsToState } from "@/lib/sync-event-apply";
import type { State } from "@/lib/store";

const TENANT = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const PRODUCT = "product-789";

function initialState(): State {
  return {
    contacts: [],
    products: [{ id: PRODUCT, code: "789", name: "Produto teste", price: 10, cost: 5, stock: 10, minStock: 0, category: "Geral", unit: "un" }],
    cart: [],
    sales: [],
    stockMovements: [],
    cashSessions: [],
    cashMovements: [],
    conferences: [],
    receiving: [],
    manualExpiries: [],
    stockAdjustments: [],
    stockWriteoffs: [],
    stockTransfers: [],
    promotions: [],
    suppliers: [],
    settings: {},
  } as State;
}

const saleEvent: SyncEvent = {
  event_id: "sale-event-1",
  sequence: "41",
  category: "sales",
  delivery_mode: "automatic",
  entity_type: "sale",
  entity_id: "sale-site-1",
  created_at: "2026-11-26T12:00:00.000Z",
  payload: {
    saleId: "sale-site-1",
    total: 20,
    paymentMethod: "cash",
    paymentStatus: "paid",
    sale: {
      id: "sale-site-1",
      date: "2026-11-26T12:00:00.000Z",
      total: 20,
      payment: "Dinheiro",
      paid: true,
      items: [{ productId: PRODUCT, name: "Produto teste", price: 10, cost: 5, qty: 2, unit: "un" }],
    },
  },
};

const stockEvent: SyncEvent = {
  event_id: "stock-event-1",
  sequence: "42",
  category: "stock",
  delivery_mode: "automatic",
  entity_type: "product",
  entity_id: PRODUCT,
  created_at: "2026-11-26T12:00:00.000Z",
  payload: {
    stockDelta: -2,
    resultingStock: 8,
    source: "sale",
    saleId: "sale-site-1",
    operationId: "sale-site-1",
    quantity: 2,
    stockBefore: 10,
    stockAfter: 8,
    productCode: "789",
    productName: "Produto teste",
    unit: "un",
    totalValue: 20,
    occurredAt: "2026-11-26T12:00:00.000Z",
  },
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeOutbox(pending: ReturnType<typeof createSyncCommand>[] = []) {
  let cursor = "40";
  return {
    listPending: vi.fn().mockResolvedValue(pending),
    markAttempt: vi.fn().mockResolvedValue(undefined),
    acknowledge: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    pendingCount: vi.fn().mockImplementation(async () => pending.length ? 0 : 0),
    failedCount: vi.fn().mockResolvedValue(0),
    getCursor: vi.fn().mockImplementation(async () => cursor),
    setCursor: vi.fn().mockImplementation(async (_tenantId: string, value: string) => { cursor = value; }),
  } as unknown as SyncOutbox;
}

describe("MobFlow two-way incremental synchronization", () => {
  it("receives a sale and its stock balance from the official site into the EXE projection", async () => {
    const outbox = fakeOutbox();
    let local = initialState();
    const transport = vi.fn().mockResolvedValue(response({
      ok: true,
      events: [saleEvent, stockEvent],
      cursor: "40",
      nextCursor: "42",
      highWaterMark: "42",
      hasMore: false,
    }));

    const result = await pullSyncEvents(outbox, TENANT, (events) => {
      local = applySyncEventsToState(local, events);
    }, transport);

    expect(transport).toHaveBeenCalledWith(
      "/api/mobflow/sync/events?cursor=40&limit=100",
      expect.objectContaining({ method: "GET" }),
    );
    expect(local.sales).toHaveLength(1);
    expect(local.sales[0]).toMatchObject({ id: "sale-site-1", total: 20 });
    expect(local.products[0]?.stock).toBe(8);
    expect(local.stockMovements).toHaveLength(1);
    expect(result).toMatchObject({ applied: 2, cursor: "42", hasMore: false });
  });

  it("sends an EXE sale to Neon and applies the server-confirmed sale and stock events", async () => {
    const command = createSyncCommand({
      tenantId: TENANT,
      domain: "sales",
      id: "a6c47ea1-2abf-4cd6-b614-24e27077bdf6",
      idempotencyKey: "b6c47ea1-2abf-4cd6-b614-24e27077bdf6",
      payload: { saleId: "sale-site-1", cashSessionId: "cash-1", items: [{ productId: PRODUCT, quantity: 2 }] },
    });
    const outbox = fakeOutbox([command]);
    let local = initialState();
    const transport = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/mobflow/sales" && init?.method === "POST") {
        return response({ ok: true, replayed: false, sale: { id: "sale-site-1", total: 20 } }, 201);
      }
      if (String(input).startsWith("/api/mobflow/sync/events?")) {
        return response({
          ok: true,
          events: [saleEvent, stockEvent],
          cursor: "40",
          nextCursor: "42",
          highWaterMark: "42",
          hasMore: false,
        });
      }
      throw new Error("Unexpected sync request: " + String(input));
    });

    const result = await runIncrementalSync({
      outbox,
      tenantId: TENANT,
      transport,
      applyEvents: (events) => { local = applySyncEventsToState(local, events); },
    });

    expect(transport).toHaveBeenCalledWith("/api/mobflow/sales", expect.objectContaining({ method: "POST" }));
    expect(outbox.acknowledge).toHaveBeenCalledWith(command.id);
    expect(local.sales).toHaveLength(1);
    expect(local.sales[0]?.id).toBe("sale-site-1");
    expect(local.products[0]?.stock).toBe(8);
    expect(result).toMatchObject({ sent: 1, failed: 0, pending: 0, applied: 2, cursor: "42" });
  });
});
