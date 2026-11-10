import { describe, expect, it, vi } from "vitest";
import type { State } from "@/lib/store";
import { applySyncEventsToState, UnsupportedSyncEventError } from "@/lib/sync-event-apply";
import { pullSyncEvents, SyncOutbox, type SyncEvent, type SyncTransport } from "@/lib/sync-outbox";

const emptyState = (): State => ({
  contacts: [], products: [{
    id: "product-1", code: "789", name: "Produto teste", price: 10, cost: 5,
    stock: 10, minStock: 0, category: "Geral", unit: "un",
  }],
  cart: [], sales: [], stockMovements: [], cashSessions: [], cashMovements: [],
  conferences: [], receiving: [], manualExpiries: [], stockAdjustments: [],
  stockWriteoffs: [], stockTransfers: [], promotions: [], suppliers: [],
  settings: { companyName: "Empresa de teste" },
});

const event = (input: Partial<SyncEvent> & Pick<SyncEvent, "sequence" | "category" | "entity_type" | "entity_id" | "payload">): SyncEvent => ({
  event_id: `event-${input.sequence}`,
  sequence: input.sequence,
  category: input.category,
  delivery_mode: "automatic",
  entity_type: input.entity_type,
  entity_id: input.entity_id,
  payload: input.payload,
  created_at: "2026-11-08T12:00:00.000Z",
});

class MemoryCursorOutbox extends SyncOutbox {
  cursor = "0";
  async getCursor() { return this.cursor; }
  async setCursor(_tenantId: string, value: string) {
    if (BigInt(value) > BigInt(this.cursor)) this.cursor = value;
  }
}

describe("applySyncEventsToState", () => {
  it("applies the current sales event contract and safely replays the same sale", () => {
    const sale = {
      id: "sale-1", date: "2026-11-08T12:00:00.000Z", total: 20,
      subtotal: 20, discount: 0, discountType: "R$", profit: 10,
      payment: "Dinheiro", received: 20, paid: true,
      items: [{ productId: "product-1", name: "Produto teste", price: 10, cost: 5, qty: 2, unit: "un" }],
    };
    const saleEvent = event({
      sequence: "2", category: "sales", entity_type: "sale", entity_id: "sale-1",
      payload: { sale, saleId: "sale-1", total: 20, paymentMethod: "cash", paymentStatus: "paid" },
    });

    const once = applySyncEventsToState(emptyState(), [saleEvent]);
    const twice = applySyncEventsToState(once, [saleEvent]);

    expect(twice.sales).toHaveLength(1);
    expect(twice.sales[0]).toMatchObject({ id: "sale-1", total: 20, payment: "Dinheiro" });
    expect(twice.sales[0]?.items).toHaveLength(1);
  });

  it("applies the current sale stock event contract and does not duplicate its ledger row on replay", () => {
    const stockEvent = event({
      sequence: "1", category: "stock", entity_type: "product", entity_id: "product-1",
      payload: {
        stockDelta: -2, resultingStock: 8, source: "sale", saleId: "sale-1",
        operationId: "sale-1", quantity: 2, stockBefore: 10, stockAfter: 8,
        productCode: "789", productName: "Produto teste", unit: "un",
        totalValue: 20, operator: "Caixa", occurredAt: "2026-11-08T12:00:00.000Z",
      },
    });

    const once = applySyncEventsToState(emptyState(), [stockEvent]);
    const twice = applySyncEventsToState(once, [stockEvent]);

    expect(twice.products[0]?.stock).toBe(8);
    expect(twice.stockMovements).toHaveLength(1);
    expect(twice.stockMovements[0]).toMatchObject({
      id: "sale-1:product-1", operationId: "sale-1", delta: -2,
      stockBefore: 10, stockAfter: 8, quantity: 2, type: "Venda",
    });
  });

  it("applies manual stock movement events and the complementary adjustment event", () => {
    const productEvent = event({
      sequence: "3", category: "stock", entity_type: "product", entity_id: "product-1",
      payload: {
        operationId: "adjustment-1", operationType: "adjustment", delta: 3,
        stockBefore: 10, stockAfter: 13, quantity: 3, productCode: "789",
        productName: "Produto teste", unit: "un", totalValue: 15,
        reason: "Correção de inventário", operator: "Gerente",
        occurredAt: "2026-11-08T12:01:00.000Z",
      },
    });
    const operationEvent = event({
      sequence: "4", category: "stock", entity_type: "stock_operation", entity_id: "adjustment-1",
      payload: {
        operationId: "adjustment-1", operationType: "adjustment",
        stockAdjustment: {
          id: "adjustment-1", date: "2026-11-08T12:01:00.000Z",
          reason: "Correção de inventário", operator: "Gerente",
          items: [{
            productId: "product-1", code: "789", name: "Produto teste",
            unit: "un", mode: "somar", quantity: 3, previousStock: 10, newStock: 13,
          }],
        },
      },
    });

    const result = applySyncEventsToState(emptyState(), [productEvent, operationEvent]);

    expect(result.products[0]?.stock).toBe(13);
    expect(result.stockMovements).toHaveLength(1);
    expect(result.stockAdjustments).toHaveLength(1);
    expect(result.stockAdjustments[0]?.id).toBe("adjustment-1");
  });

  it("processes successive stock events in sequence order and keeps the newest balance", () => {
    const first = event({
      sequence: "10", category: "stock", entity_type: "product", entity_id: "product-1",
      payload: { operationId: "op-1", operationType: "entry", delta: 2, stockBefore: 10, stockAfter: 12, quantity: 2 },
    });
    const second = event({
      sequence: "11", category: "stock", entity_type: "product", entity_id: "product-1",
      payload: { operationId: "op-2", operationType: "writeoff", delta: -1, stockBefore: 12, stockAfter: 11, quantity: 1 },
    });

    const result = applySyncEventsToState(emptyState(), [first, second]);

    expect(result.products[0]?.stock).toBe(11);
    expect(result.stockMovements.map((movement) => movement.id)).toEqual(["op-2:product-1", "op-1:product-1"]);
  });

  it("applies a state-update balance without inventing a missing ledger movement", () => {
    const legacy = event({
      sequence: "1", category: "stock", entity_type: "product", entity_id: "product-1",
      payload: { source: "state_update", stockDelta: -1, resultingStock: 9 },
    });

    const result = applySyncEventsToState(emptyState(), [legacy]);
    expect(result.products[0]?.stock).toBe(9);
    expect(result.stockMovements).toHaveLength(0);
  });

  it("applies catalog upserts and deletes without overwriting local stock or photo metadata", () => {
    const current = emptyState();
    current.products[0] = { ...current.products[0]!, stock: 17, photoObjectKey: "r2/photo.png" };
    const catalog = event({ sequence: "5", category: "catalog", entity_type: "product", entity_id: "product-1", delivery_mode: "manual", payload: { operation: "upsert", product: { id: "product-1", code: "789", name: "Nome novo", unit: "un", price: 12, cost: 6, minStock: 2, category: "Bebidas", version: 2, barcodes: ["789"] } } });
    const updated = applySyncEventsToState(current, [catalog]);
    expect(updated.products[0]).toMatchObject({ name: "Nome novo", price: 12, stock: 17, photoObjectKey: "r2/photo.png" });
    const deleted = applySyncEventsToState(updated, [event({ sequence: "6", category: "catalog", entity_type: "product", entity_id: "product-1", payload: { operation: "delete" } })]);
    expect(deleted.products).toHaveLength(0);
  });

  it("applies conference and expiry events idempotently", () => {
    const conference = event({ sequence: "7", category: "conference", entity_type: "conference", entity_id: "conf-1", delivery_mode: "manual", payload: { operation: "upsert", conference: { id: "conf-1", name: "Contagem", date: "2026-11-10", status: "aberta", counts: {}, unknown: [] } } });
    const expiry = event({ sequence: "8", category: "master_data", entity_type: "manual_expiry", entity_id: "expiry-1", delivery_mode: "manual", payload: { operation: "upsert", manualExpiry: { id: "expiry-1", productId: "product-1", name: "Produto teste", quantity: 2, expiry: "2027-01-01", unit: "un" } } });
    const once = applySyncEventsToState(emptyState(), [conference, expiry]);
    const twice = applySyncEventsToState(once, [conference, expiry]);
    expect(twice.conferences).toHaveLength(1);
    expect(twice.manualExpiries).toHaveLength(1);
  });

  it("applies receiving decisions and stock deltas without requiring a snapshot", () => {
    const current = emptyState();
    current.receiving = [{ id: "receipt-1", number: "NF1", supplier: "Fornecedor", date: "2026-11-10", items: [{ productId: "product-1", name: "Produto teste", expected: 2, received: 3, unit: "un" }], status: "analisando" }];
    const receiving = event({ sequence: "9", category: "receiving", entity_type: "receiving", entity_id: "receipt-1", delivery_mode: "manual", payload: { status: "aceito", decisionCompleted: true, lines: [{ productId: "product-1", received: 3, decision: "aceitar" }] } });
    const stock = event({ sequence: "10", category: "stock", entity_type: "product", entity_id: "product-1", payload: { stockDelta: 3, source: "receiving" } });
    const once = applySyncEventsToState(current, [receiving, stock]);
    const twice = applySyncEventsToState(once, [receiving, stock]);
    expect(twice.receiving[0]).toMatchObject({ status: "aceito", decisionCompleted: true, stockReleased: true });
    expect(twice.products[0]?.stock).toBe(13);
    expect(twice.stockMovements).toHaveLength(1);
  });

  it("applies supplier and safe company settings changes", () => {
    const supplier = event({ sequence: "11", category: "master_data", entity_type: "supplier", entity_id: "fornecedor ltda", delivery_mode: "manual", payload: { operation: "upsert", name: "Fornecedor Ltda" } });
    const settings = event({ sequence: "12", category: "settings", entity_type: "company_settings", entity_id: "company", delivery_mode: "manual", payload: { operation: "changed", keys: ["companyName"], values: { companyName: "Mercado Novo" } } });
    const result = applySyncEventsToState(emptyState(), [supplier, settings]);
    expect(result.suppliers).toEqual([{ name: "Fornecedor Ltda" }]);
    expect(result.settings).toMatchObject({ companyName: "Mercado Novo" });
  });

  it("rejects unsupported legacy catalog and cash-session event shapes", () => {
    const legacyProduct = event({
      sequence: "1", category: "catalog", entity_type: "product", entity_id: "product-1",
      payload: { operation: "upsert", product: { id: "product-1", stock: 10 } },
    });
    const legacyCash = event({
      sequence: "2", category: "master_data", entity_type: "cash_session", entity_id: "cash-1",
      payload: { metadata: { id: "cash-1", status: "open" }, operation: "upsert" },
    });

    expect(() => applySyncEventsToState(emptyState(), [legacyProduct])).toThrow(UnsupportedSyncEventError);
    expect(() => applySyncEventsToState(emptyState(), [legacyCash])).toThrow(UnsupportedSyncEventError);
  });
});

describe("pullSyncEvents ordering and cursor safety", () => {
  it("applies only strictly increasing sequences and advances the cursor after application", async () => {
    const outbox = new MemoryCursorOutbox();
    const events = [
      event({ sequence: "1", category: "stock", entity_type: "product", entity_id: "product-1", payload: { stockAfter: 9 } }),
      event({ sequence: "2", category: "sales", entity_type: "sale", entity_id: "sale-1", payload: { sale: { id: "sale-1", items: [] } } }),
    ];
    const apply = vi.fn();
    const transport: SyncTransport = vi.fn(async () => new Response(JSON.stringify({
      ok: true, events, nextCursor: "2", hasMore: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await pullSyncEvents(outbox, "tenant-1", apply, transport);

    expect(result).toMatchObject({ applied: 2, cursor: "2", hasMore: false });
    expect(apply).toHaveBeenCalledWith(events);
    expect(outbox.cursor).toBe("2");
  });

  it("rejects duplicated or out-of-order sequences without applying or advancing the cursor", async () => {
    const outbox = new MemoryCursorOutbox();
    const events = [
      event({ sequence: "2", category: "stock", entity_type: "product", entity_id: "product-1", payload: {} }),
      event({ sequence: "2", category: "stock", entity_type: "product", entity_id: "product-1", payload: {} }),
    ];
    const apply = vi.fn();
    const transport: SyncTransport = async () => new Response(JSON.stringify({
      ok: true, events, nextCursor: "2", hasMore: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

    await expect(pullSyncEvents(outbox, "tenant-1", apply, transport)).rejects.toThrow(/sequência inválida ou fora de ordem/i);
    expect(apply).not.toHaveBeenCalled();
    expect(outbox.cursor).toBe("0");
  });

  it("does not advance the cursor when applying a valid page fails", async () => {
    const outbox = new MemoryCursorOutbox();
    const events = [event({ sequence: "1", category: "sales", entity_type: "sale", entity_id: "sale-1", payload: {} })];
    const transport: SyncTransport = async () => new Response(JSON.stringify({
      ok: true, events, nextCursor: "1", hasMore: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

    await expect(pullSyncEvents(outbox, "tenant-1", () => {
      throw new Error("apply failed");
    }, transport)).rejects.toThrow("apply failed");
    expect(outbox.cursor).toBe("0");
  });
});
