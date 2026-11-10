import type { State, Sale, StockMovement } from "@/lib/store";
import type { SyncEvent } from "@/lib/sync-outbox";

export class UnsupportedSyncEventError extends Error {
  constructor(readonly event: SyncEvent) {
    super(`Evento ainda não suportado pelo sincronizador incremental: ${event.category}/${event.entity_type}.`);
    this.name = "UnsupportedSyncEventError";
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const number = (value: unknown): number | null => {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : null;
};
function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index < 0) return [item, ...items];
  const next = [...items];
  next[index] = { ...next[index], ...item };
  return next;
}

export function applySyncEventsToState(current: State, events: SyncEvent[]): State {
  const next: State = {
    ...current,
    products: [...(current.products ?? [])],
    sales: [...(current.sales ?? [])],
    stockMovements: [...(current.stockMovements ?? [])],
    cashSessions: [...(current.cashSessions ?? [])],
    cashMovements: [...(current.cashMovements ?? [])],
    stockAdjustments: [...(current.stockAdjustments ?? [])],
  };

  for (const event of events) {
    const payload = event.payload ?? {};

    if (event.category === "catalog" && event.entity_type === "product") {
      if (payload["operation"] === "delete") {
        next.products = next.products.filter((item) => item.id !== event.entity_id);
        continue;
      }
      const raw = record(payload["product"]);
      if (!raw || typeof raw["id"] !== "string" || typeof raw["code"] !== "string" || typeof raw["name"] !== "string") throw new UnsupportedSyncEventError(event);
      const unit = raw["unit"] === "kg" ? "kg" : raw["unit"] === "un" ? "un" : null;
      const price = number(raw["price"]), cost = number(raw["cost"]), minStock = number(raw["minStock"]);
      if (!unit || price === null || cost === null || minStock === null) throw new UnsupportedSyncEventError(event);
      const existing = next.products.find((item) => item.id === event.entity_id);
      next.products = upsert(next.products, {
        id: raw["id"], code: raw["code"], name: raw["name"],
        ref: typeof raw["reference"] === "string" ? raw["reference"] : typeof raw["ref"] === "string" ? raw["ref"] : undefined,
        unit, price, cost, minStock, category: typeof raw["category"] === "string" ? raw["category"] : "",
        version: number(raw["version"]) ?? existing?.version,
        barcodes: Array.isArray(raw["barcodes"]) ? raw["barcodes"].filter((item): item is string => typeof item === "string") : existing?.barcodes ?? [],
        stock: existing?.stock ?? 0, photoObjectKey: existing?.photoObjectKey,
      });
      continue;
    }

    if (event.category === "conference" && event.entity_type === "conference") {
      if (payload["operation"] === "delete") {
        next.conferences = next.conferences.filter((item) => item.id !== event.entity_id);
        continue;
      }
      const raw = record(payload["conference"]);
      if (!raw || typeof raw["id"] !== "string" || typeof raw["name"] !== "string" || !record(raw["counts"])) throw new UnsupportedSyncEventError(event);
      next.conferences = upsert(next.conferences, raw as unknown as State["conferences"][number]);
      continue;
    }

    if (event.category === "master_data" && event.entity_type === "manual_expiry") {
      if (payload["operation"] === "delete") {
        next.manualExpiries = next.manualExpiries.filter((item) => item.id !== event.entity_id);
        continue;
      }
      const raw = record(payload["manualExpiry"]);
      if (!raw || typeof raw["id"] !== "string" || typeof raw["productId"] !== "string" || typeof raw["name"] !== "string" || typeof raw["expiry"] !== "string") throw new UnsupportedSyncEventError(event);
      const quantity = number(raw["quantity"]);
      if (quantity === null || (raw["unit"] !== "un" && raw["unit"] !== "kg")) throw new UnsupportedSyncEventError(event);
      next.manualExpiries = upsert(next.manualExpiries, { id: raw["id"], productId: raw["productId"], name: raw["name"], quantity, expiry: raw["expiry"], unit: raw["unit"] });
      continue;
    }

    if (event.category === "sales" && event.entity_type === "sale") {
      const rawSale = record(payload["sale"]);
      if (!rawSale || typeof rawSale["id"] !== "string" || !Array.isArray(rawSale["items"])) throw new UnsupportedSyncEventError(event);
      next.sales = upsert(next.sales, rawSale as unknown as Sale);
      continue;
    }

    if (event.category === "cash" && event.entity_type === "cash_session") {
      const sessionId = String(payload["sessionId"] ?? event.entity_id);
      const existing = next.cashSessions.find((item) => item.id === sessionId);
      if (payload["status"] === "open") {
        const openingAmount = number(payload["openingAmount"]);
        if (openingAmount === null || typeof payload["openedAt"] !== "string") throw new UnsupportedSyncEventError(event);
        const openedBy = typeof payload["operator"] === "string" ? payload["operator"] : existing?.openedBy ?? "";
        const note = typeof payload["note"] === "string" ? { note: payload["note"] } : {};
        next.cashSessions = upsert(next.cashSessions, {
          id: sessionId, openedAt: payload["openedAt"], openedBy, openingAmount,
          status: "open", ...note,
        });
      } else if (payload["status"] === "closed") {
        if (!existing) throw new UnsupportedSyncEventError(event);
        const countedCash = number(payload["countedAmount"]), expectedCash = number(payload["expectedAmount"]), difference = number(payload["difference"]);
        if (countedCash === null || expectedCash === null || difference === null) throw new UnsupportedSyncEventError(event);
        const closedAt = typeof payload["closedAt"] === "string" ? payload["closedAt"] : event.created_at;
        const closedBy = typeof payload["operator"] === "string" ? payload["operator"] : existing.openedBy;
        const noteValue = typeof payload["note"] === "string" ? [existing.note, payload["note"]].filter(Boolean).join(" · ") : existing.note;
        const note = noteValue ? { note: noteValue } : {};
        next.cashSessions = upsert(next.cashSessions, {
          ...existing, status: "closed", closedAt, closedBy, countedCash, expectedCash, difference, ...note,
        });
      } else throw new UnsupportedSyncEventError(event);
      continue;
    }

    if (event.category === "cash" && event.entity_type === "cash_movement") {
      const rawMovement = record(payload["movement"]);
      if (!rawMovement || typeof rawMovement["id"] !== "string" || typeof rawMovement["sessionId"] !== "string") throw new UnsupportedSyncEventError(event);
      const amount = number(rawMovement["amount"]);
      if (amount === null || (rawMovement["type"] !== "sangria" && rawMovement["type"] !== "reforco")) throw new UnsupportedSyncEventError(event);
      next.cashMovements = upsert(next.cashMovements, {
        id: rawMovement["id"], sessionId: rawMovement["sessionId"], type: rawMovement["type"],
        amount, reason: String(rawMovement["reason"] ?? ""), operator: String(rawMovement["operator"] ?? ""),
        date: typeof rawMovement["date"] === "string" ? rawMovement["date"] : event.created_at,
      });
      continue;
    }

    if (event.category === "stock" && event.entity_type === "product") {
      const product = next.products.find((item) => item.id === event.entity_id);
      const stockAfter = number(payload["stockAfter"] ?? payload["resultingStock"]);
      if (!product || stockAfter === null) throw new UnsupportedSyncEventError(event);
      next.products = next.products.map((item) => item.id === event.entity_id ? { ...item, stock: stockAfter } : item);
      const operationId = typeof payload["operationId"] === "string" ? payload["operationId"] : undefined;
      const quantity = number(payload["quantity"]);
      const stockBefore = number(payload["stockBefore"]);
      if (operationId && quantity !== null && stockBefore !== null) {
        const delta = number(payload["delta"] ?? payload["stockDelta"]) ?? stockAfter - stockBefore;
        const operationType = String(payload["operationType"] ?? payload["source"] ?? "");
        const movementType = operationType === "sale" || payload["source"] === "sale" ? "Venda"
          : operationType === "writeoff" ? "Baixa"
          : operationType === "entry" ? "Entrada"
          : /balanço/i.test(String(payload["reason"] ?? "")) ? "Balanço"
          : operationType === "adjustment" ? "Ajuste de estoque" : "Movimentação";
        const operator = typeof payload["operator"] === "string" ? { operator: payload["operator"] } : {};
        const movement: StockMovement = {
          id: `${operationId}:${event.entity_id}`, operationId,
          date: typeof payload["occurredAt"] === "string" ? payload["occurredAt"] : event.created_at,
          type: movementType, productId: event.entity_id,
          productCode: typeof payload["productCode"] === "string" ? payload["productCode"] : product.code,
          productName: typeof payload["productName"] === "string" ? payload["productName"] : product.name,
          unit: payload["unit"] === "kg" ? "kg" : product.unit,
          quantity, totalValue: number(payload["totalValue"]) ?? 0,
          stockBefore, stockAfter, delta,
          ...operator,
          details: typeof payload["reason"] === "string" ? payload["reason"] : `${movementType} ${operationId}`,
        };
        next.stockMovements = upsert(next.stockMovements, movement);
      }
      continue;
    }

    if (event.category === "stock" && ["stock_operation", "stock_adjustment", "stock_writeoff", "stock_transfer"].includes(event.entity_type)) {
      const rawAdjustment = record(payload["stockAdjustment"] ?? payload["stockOperation"]);
      if (rawAdjustment && typeof rawAdjustment["id"] === "string" && Array.isArray(rawAdjustment["items"])) {
        if (event.entity_type === "stock_writeoff") next.stockWriteoffs = upsert(next.stockWriteoffs, rawAdjustment as unknown as State["stockWriteoffs"][number]);
        else if (event.entity_type === "stock_transfer") next.stockTransfers = upsert(next.stockTransfers, rawAdjustment as unknown as State["stockTransfers"][number]);
        else next.stockAdjustments = upsert(next.stockAdjustments, rawAdjustment as unknown as State["stockAdjustments"][number]);
      }
      // The per-product ledger events carry the authoritative balance changes.
      continue;
    }

    if (event.category === "promotions" && event.entity_type === "promotion") {
      if (payload["operation"] === "delete") {
        next.promotions = next.promotions.filter((item) => item.id !== event.entity_id);
        continue;
      }
      const rawPromotion = record(payload["promotion"]);
      if (!rawPromotion || typeof rawPromotion["id"] !== "string") throw new UnsupportedSyncEventError(event);
      const originalPrice = number(rawPromotion["originalPrice"]);
      const promoPrice = number(rawPromotion["promoPrice"]);
      if (originalPrice === null || promoPrice === null) throw new UnsupportedSyncEventError(event);
      next.promotions = upsert(next.promotions, {
        id: rawPromotion["id"],
        productId: String(rawPromotion["productId"] ?? ""),
        productName: String(rawPromotion["productName"] ?? ""),
        originalPrice,
        promoPrice,
        startsAt: typeof rawPromotion["startsAt"] === "string" ? rawPromotion["startsAt"] : "",
        endsAt: typeof rawPromotion["endsAt"] === "string" ? rawPromotion["endsAt"] : "",
      });
      continue;
    }

    if (event.category === "price" && event.entity_type === "product") {
      const product = next.products.find((item) => item.id === event.entity_id);
      const price = number(payload["price"]);
      if (!product || price === null) throw new UnsupportedSyncEventError(event);
      next.products = next.products.map((item) => item.id === event.entity_id ? { ...item, price } : item);
      continue;
    }

    throw new UnsupportedSyncEventError(event);
  }

  return next;
}
