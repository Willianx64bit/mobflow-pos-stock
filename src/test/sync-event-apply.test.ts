import { describe, expect, it } from "vitest";
import { applySyncEventsToState, UnsupportedSyncEventError } from "@/lib/sync-event-apply";
import type { State } from "@/lib/store";
import type { SyncEvent } from "@/lib/sync-outbox";

const state = {
  contacts: [], products: [{ id: "p1", code: "SKU-1", name: "Arroz", price: 10, cost: 5, stock: 10, minStock: 2, category: "Geral", unit: "un" }],
  cart: [], sales: [], stockMovements: [], cashSessions: [], cashMovements: [],
  conferences: [], receiving: [], manualExpiries: [], stockAdjustments: [], stockWriteoffs: [],
  stockTransfers: [], promotions: [], suppliers: [], settings: { companyName: "Loja" },
} as State;

const event = (input: Partial<SyncEvent> & Pick<SyncEvent, "category" | "entity_type" | "entity_id" | "payload">): SyncEvent => ({
  event_id: "event-1", sequence: "1", delivery_mode: "manual", created_at: "2026-11-08T12:00:00.000Z",
  ...input,
});

describe("MobFlow incremental event projection", () => {
  it("applies sale snapshots idempotently by sale ID", () => {
    const sale = { id: "sale-1", date: "2026-11-08T12:00:00.000Z", cashSessionId: "cash-1", items: [{ productId: "p1", name: "Arroz", price: 10, qty: 2 }], total: 20, payment: "Dinheiro" };
    const saleEvent = event({ category: "sales", entity_type: "sale", entity_id: "sale-1", payload: { sale } });
    const once = applySyncEventsToState(state, [saleEvent]);
    const twice = applySyncEventsToState(once, [saleEvent]);
    expect(twice.sales).toHaveLength(1);
    expect(twice.sales[0]).toMatchObject({ id: "sale-1", total: 20 });
  });

  it("sets the resulting stock balance and inserts a stable ledger movement", () => {
    const stockEvent = event({
      category: "stock", entity_type: "product", entity_id: "p1",
      payload: { operationId: "sale-1", operationType: "sale", source: "sale", quantity: 2, stockBefore: 10, stockAfter: 8, delta: -2, totalValue: 20, productCode: "SKU-1", productName: "Arroz", unit: "un" },
    });
    const once = applySyncEventsToState(state, [stockEvent]);
    const twice = applySyncEventsToState(once, [stockEvent]);
    expect(twice.products[0]?.stock).toBe(8);
    expect(twice.stockMovements).toHaveLength(1);
    expect(twice.stockMovements[0]).toMatchObject({ id: "sale-1:p1", stockBefore: 10, stockAfter: 8, delta: -2 });
  });

  it("applies cash session and movement events", () => {
    const opened = event({ category: "cash", entity_type: "cash_session", entity_id: "cash-1", payload: { sessionId: "cash-1", status: "open", openingAmount: 100, openedAt: "2026-11-08T10:00:00.000Z", operator: "Operador" } });
    const movement = event({ category: "cash", entity_type: "cash_movement", entity_id: "movement-1", payload: { movement: { id: "movement-1", sessionId: "cash-1", type: "reforco", amount: 20, reason: "Troco", operator: "Operador", date: "2026-11-08T10:05:00.000Z" } } });
    const next = applySyncEventsToState(state, [opened, movement]);
    expect(next.cashSessions[0]).toMatchObject({ id: "cash-1", status: "open", openingAmount: 100 });
    expect(next.cashMovements[0]).toMatchObject({ id: "movement-1", type: "reforco", amount: 20 });
  });

  it("replaces an optimistic cash movement with the canonical server ID", () => {
    const optimistic = {
      id: "local-movement-id", sessionId: "cash-1", type: "reforco" as const,
      amount: 20, reason: "Troco", operator: "Operador", date: "2026-11-08T10:04:59.000Z",
    };
    const current = { ...state, cashMovements: [optimistic] } as State;
    const movement = event({
      category: "cash", entity_type: "cash_movement", entity_id: "server-movement-id",
      payload: { movement: { id: "server-movement-id", sessionId: "cash-1", type: "reforco", amount: 20, reason: "Troco", operator: "Operador", date: "2026-11-08T10:05:00.000Z" } },
    });
    const next = applySyncEventsToState(current, [movement]);
    expect(next.cashMovements).toHaveLength(1);
    expect(next.cashMovements[0]).toMatchObject({ id: "server-movement-id", amount: 20, reason: "Troco" });
  });

  it("restores adjustment, writeoff and transfer history from Neon operation events", () => {
    const adjustment = event({
      category: "stock", entity_type: "stock_operation", entity_id: "adjustment-1",
      payload: { operationId: "adjustment-1", operationType: "adjustment", stockAdjustment: { id: "adjustment-1", reason: "Balanço", items: [{ productId: "p1", quantity: 4 }] } },
    });
    const writeoff = event({
      category: "stock", entity_type: "stock_writeoff", entity_id: "writeoff-1",
      payload: { operation: "upsert", stockOperation: { id: "writeoff-1", reason: "Perda", items: [{ productId: "p1", quantity: 1 }] } },
    });
    const transfer = event({
      category: "stock", entity_type: "stock_transfer", entity_id: "transfer-1",
      payload: { operation: "upsert", stockOperation: { id: "transfer-1", destinationName: "Loja B", items: [{ productId: "p1", quantity: 2 }] } },
    });
    const next = applySyncEventsToState(state, [adjustment, writeoff, transfer]);
    expect(next.stockAdjustments).toHaveLength(1);
    expect(next.stockAdjustments[0]).toMatchObject({ id: "adjustment-1", reason: "Balanço" });
    expect(next.stockWriteoffs).toHaveLength(1);
    expect(next.stockWriteoffs[0]).toMatchObject({ id: "writeoff-1", reason: "Perda" });
    expect(next.stockTransfers).toHaveLength(1);
    expect(next.stockTransfers[0]).toMatchObject({ id: "transfer-1", destinationName: "Loja B" });
  });

  it("applies promotion upserts, preserves versions and deletes idempotently", () => {
    const promotionEvent = event({
      category: "promotions", entity_type: "promotion", entity_id: "promo-1",
      payload: { operation: "upsert", version: 2, promotion: { id: "promo-1", productId: "p1", productName: "Arroz", originalPrice: 10, promoPrice: 8, startsAt: "2026-11-08", endsAt: "2026-11-10", version: 2 } },
    });
    const once = applySyncEventsToState(state, [promotionEvent]);
    const twice = applySyncEventsToState(once, [promotionEvent]);
    expect(twice.promotions).toHaveLength(1);
    expect(twice.promotions[0]).toMatchObject({ id: "promo-1", promoPrice: 8, version: 2 });
    const deleted = applySyncEventsToState(twice, [event({
      category: "promotions", entity_type: "promotion", entity_id: "promo-1",
      payload: { operation: "delete" },
    })]);
    expect(deleted.promotions).toHaveLength(0);
  });

  it("does not roll back a promotion when an older version event is replayed", () => {
    const current = applySyncEventsToState(state, [event({
      sequence: "12", category: "promotions", entity_type: "promotion", entity_id: "promo-1",
      payload: { operation: "update", version: 3, promotion: { id: "promo-1", productId: "p1", productName: "Arroz", originalPrice: 10, promoPrice: 7, startsAt: "2026-11-08", endsAt: "2026-11-10", version: 3 } },
    })]);
    const stale = applySyncEventsToState(current, [event({
      sequence: "11", category: "promotions", entity_type: "promotion", entity_id: "promo-1",
      payload: { operation: "update", version: 2, promotion: { id: "promo-1", productId: "p1", productName: "Arroz", originalPrice: 10, promoPrice: 8, startsAt: "2026-11-08", endsAt: "2026-11-10", version: 2 } },
    })]);
    expect(stale.promotions[0]).toMatchObject({ id: "promo-1", promoPrice: 7, version: 3 });
  });

  it("does not silently advance over event categories without an application contract", () => {
    const unsupported = event({ category: "conference", entity_type: "conference", entity_id: "conf-1", payload: { operation: "upsert" } });
    expect(() => applySyncEventsToState(state, [unsupported])).toThrow(UnsupportedSyncEventError);
  });
});
