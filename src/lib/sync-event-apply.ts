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
    // Product catalog mutations are manual-only. A different automatic event
    // must never cause a queued catalog change to appear on another device.
    if (event.delivery_mode === "manual" && event.category === "catalog" && event.entity_type === "product") continue;
    const payload = event.payload ?? {};

    if (event.category === "catalog" && event.entity_type === "product") {
      const existing = next.products.find((item) => item.id === event.entity_id);
      if (payload["operation"] === "photo_updated" || payload["operation"] === "photo_removed") {
        const photoVersion = number(payload["version"]);
        if (photoVersion === null) throw new UnsupportedSyncEventError(event);
        if (!existing || (existing.version !== undefined && photoVersion <= existing.version)) continue;
        next.products = next.products.map((item) => item.id === event.entity_id
          ? { ...item, photoObjectKey: typeof payload["photoObjectKey"] === "string" ? payload["photoObjectKey"] : undefined, version: photoVersion }
          : item);
        continue;
      }
      if (payload["operation"] === "delete") {
        const deletedVersion = number(payload["version"]);
        // An old delete event must not remove a product already updated at a newer version.
        if (existing && deletedVersion !== null && existing.version !== undefined && existing.version > deletedVersion) continue;
        next.products = next.products.filter((item) => item.id !== event.entity_id);
        continue;
      }
      const raw = record(payload["product"]);
      if (!raw || typeof raw["id"] !== "string" || raw["id"] !== event.entity_id || typeof raw["code"] !== "string" || typeof raw["name"] !== "string") throw new UnsupportedSyncEventError(event);
      const productVersion = number(raw["version"]) ?? existing?.version;
      // Replayed or delayed catalog changes cannot overwrite an equal/newer version.
      if (productVersion !== undefined && existing?.version !== undefined && productVersion <= existing.version) continue;
      if (raw["active"] === false) {
        next.products = next.products.filter((item) => item.id !== event.entity_id);
        continue;
      }
      const unit = raw["unit"] === "kg" ? "kg" : raw["unit"] === "un" ? "un" : null;
      const price = number(raw["price"]), cost = number(raw["cost"]), minStock = number(raw["minStock"]);
      if (!unit || price === null || cost === null || minStock === null) throw new UnsupportedSyncEventError(event);
      next.products = upsert(next.products, {
        id: raw["id"], code: raw["code"], name: raw["name"],
        ref: typeof raw["reference"] === "string" ? raw["reference"] : typeof raw["ref"] === "string" ? raw["ref"] : undefined,
        unit, price, cost, minStock, category: typeof raw["category"] === "string" ? raw["category"] : "",
        ...(productVersion !== undefined ? { version: productVersion } : {}),
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
      if (!raw || typeof raw["id"] !== "string" || raw["id"] !== event.entity_id || typeof raw["name"] !== "string" || !record(raw["counts"])) throw new UnsupportedSyncEventError(event);
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

    if (event.category === "receiving" && event.entity_type === "receiving") {
      const existing = next.receiving.find((item) => item.id === event.entity_id);
      if (payload["operation"] === "delete") {
        next.receiving = next.receiving.filter((item) => item.id !== event.entity_id);
        continue;
      }
      const rawReceiving = record(payload["receiving"]);
      if (rawReceiving) {
        if (typeof rawReceiving["id"] !== "string" || rawReceiving["id"] !== event.entity_id ||
          !Array.isArray(rawReceiving["items"]) ||
          !["pendente", "analisando", "conferido", "divergente", "aceito", "rejeitado"].includes(String(rawReceiving["status"]))) {
          throw new UnsupportedSyncEventError(event);
        }
        // Receiving upserts carry one note, never the whole tenant snapshot.
        // Merge partial updates into an existing note and allow a new note to be inserted.
        const incoming = rawReceiving as unknown as State["receiving"][number];
        next.receiving = upsert(next.receiving, incoming);
        continue;
      }
      if (!existing) throw new UnsupportedSyncEventError(event);
      const lines = Array.isArray(payload["lines"]) ? payload["lines"] as Array<Record<string, unknown>> : [];
      const decisions: Record<string, "aceitar" | "devolver"> = {};
      const received = new Map<string, number>();
      for (const line of lines) {
        if (typeof line["productId"] !== "string" || (line["decision"] !== "aceitar" && line["decision"] !== "devolver")) throw new UnsupportedSyncEventError(event);
        decisions[line["productId"]] = line["decision"];
        const quantity = number(line["received"]);
        if (quantity !== null) received.set(line["productId"], quantity);
      }
      const updateLines = <T extends { productId: string }>(items: T[]): T[] => items.map((item) => {
        const quantity = received.get(item.productId);
        return quantity === undefined ? item : { ...item, received: quantity } as T;
      });
      next.receiving = next.receiving.map((item) => item.id === event.entity_id ? {
        ...item, items: updateLines(item.items), extras: updateLines(item.extras ?? []),
        status: payload["status"] === "aceito" ? "aceito" : item.status,
        ...(Object.keys(decisions).length ? { decisions } : item.decisions ? { decisions: item.decisions } : {}),
        decisionCompleted: payload["decisionCompleted"] === true || item.decisionCompleted === true,
        stockReleased: payload["status"] === "aceito" || item.stockReleased === true,
      } : item);
      continue;
    }

    if (event.category === "master_data" && event.entity_type === "supplier") {
      const name = typeof payload["name"] === "string" ? payload["name"].trim() : "";
      const key = event.entity_id.toLocaleLowerCase();
      if (payload["operation"] === "delete") next.suppliers = next.suppliers.filter((item) => item.name.trim().toLocaleLowerCase() !== key);
      else {
        if (!name) throw new UnsupportedSyncEventError(event);
        const existing = next.suppliers.find((item) => item.name.trim().toLocaleLowerCase() === key);
        next.suppliers = existing ? next.suppliers.map((item) => item === existing ? { ...item, name } : item) : [{ name }, ...next.suppliers];
      }
      continue;
    }

    if (event.category === "settings" && event.entity_type === "company_settings") {
      // Private settings are rehydrated through the authenticated per-record endpoint.
      if (payload["privateOnly"] === true) continue;
      const values = record(payload["values"]);
      const keys = Array.isArray(payload["keys"]) ? payload["keys"] : [];
      // Company phone, address and tax identifiers stay redacted in the event ledger.
      // Only the non-sensitive display name can be applied from an event.
      if (!values || keys.some((key) => key !== "companyName") || Object.keys(values).some((key) => key !== "companyName")) throw new UnsupportedSyncEventError(event);
      next.settings = { ...next.settings, ...values } as State["settings"];
      continue;
    }

    if (event.category === "master_data" && event.entity_type === "business_contact") {
      // Contact details never travel in the event stream; fetch them by ID via private-data.
      if (payload["privateDetailsAvailable"] === true) continue;
      if (payload["operation"] === "delete") { next.contacts = next.contacts.filter((item) => item.id !== event.entity_id); continue; }
      const metadata = record(payload["metadata"]);
      const existing = next.contacts.find((item) => item.id === event.entity_id);
      const contactType = metadata?.["type"];
      if (!metadata || !existing || (contactType !== "Fornecedor" && contactType !== "Cliente")) throw new UnsupportedSyncEventError(event);
      next.contacts = next.contacts.map((item) => item.id === event.entity_id ? { ...item, type: contactType } : item);
      continue;
    }

    if (event.category === "master_data" && event.entity_type === "cash_session") {
      const metadata = record(payload["metadata"]), existing = next.cashSessions.find((item) => item.id === event.entity_id);
      if (!metadata || !existing) throw new UnsupportedSyncEventError(event);
      next.cashSessions = next.cashSessions.map((item) => item.id === event.entity_id ? {
        ...item, ...(metadata["status"] === "open" || metadata["status"] === "closed" ? { status: metadata["status"] } : {}),
        ...(typeof metadata["openedAt"] === "string" ? { openedAt: metadata["openedAt"] } : {}),
        ...(typeof metadata["closedAt"] === "string" ? { closedAt: metadata["closedAt"] } : {}),
      } : item);
      continue;
    }

    if (event.category === "master_data" && event.entity_type === "cash_movement") {
      const metadata = record(payload["metadata"]), existing = next.cashMovements.find((item) => item.id === event.entity_id);
      if (!metadata || !existing) throw new UnsupportedSyncEventError(event);
      const amount = number(metadata["amount"]);
      next.cashMovements = next.cashMovements.map((item) => item.id === event.entity_id ? {
        ...item, ...(amount !== null ? { amount } : {}), ...(typeof metadata["date"] === "string" ? { date: metadata["date"] } : {}),
      } : item);
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
        const openedBy = typeof payload["operatorUsername"] === "string"
          ? payload["operatorUsername"]
          : typeof payload["operator"] === "string" ? payload["operator"] : existing?.openedBy ?? "";
        const note = typeof payload["note"] === "string" ? { note: payload["note"] } : {};
        next.cashSessions = next.cashSessions.filter((item) =>
          item.status !== "open" || item.openedBy !== openedBy || item.id === sessionId
        );
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
      const movement = {
        id: rawMovement["id"], sessionId: rawMovement["sessionId"], type: rawMovement["type"] as "sangria" | "reforco",
        amount, reason: String(rawMovement["reason"] ?? ""), operator: String(rawMovement["operator"] ?? ""),
        date: typeof rawMovement["date"] === "string" ? rawMovement["date"] : event.created_at,
      };
      // Replace the optimistic local movement (which has a client ID) with the
      // server's canonical idempotency ID instead of showing the same movement twice.
      const optimistic = next.cashMovements.find((item) =>
        item.id !== movement.id && item.sessionId === movement.sessionId &&
        item.type === movement.type && item.amount === movement.amount &&
        item.reason === movement.reason && item.operator === movement.operator
      );
      if (optimistic) next.cashMovements = next.cashMovements.filter((item) => item.id !== optimistic.id);
      next.cashMovements = upsert(next.cashMovements, movement);
      continue;
    }

    if (event.category === "stock" && event.entity_type === "product") {
      const product = next.products.find((item) => item.id === event.entity_id);
      if (!product) throw new UnsupportedSyncEventError(event);
      const absoluteStock = number(payload["stockAfter"] ?? payload["resultingStock"]);
      const deltaOnly = number(payload["delta"] ?? payload["stockDelta"]);
      if (absoluteStock === null && deltaOnly === null) throw new UnsupportedSyncEventError(event);
      const stockBefore = number(payload["stockBefore"]) ?? product.stock;
      const stockAfter = absoluteStock ?? stockBefore + deltaOnly!;
      const alreadyApplied = next.stockMovements.some((movement) => movement.id === event.event_id);
      if (!alreadyApplied) next.products = next.products.map((item) => item.id === event.entity_id ? { ...item, stock: stockAfter } : item);
      const operationId = typeof payload["operationId"] === "string" ? payload["operationId"] : undefined;
      const quantity = number(payload["quantity"]) ?? (payload["source"] === "receiving" && deltaOnly !== null ? Math.abs(deltaOnly) : null);
      if (!alreadyApplied && quantity !== null) {
        const delta = number(payload["delta"] ?? payload["stockDelta"]) ?? stockAfter - stockBefore;
        const operationType = String(payload["operationType"] ?? payload["source"] ?? "");
        const movementType = operationType === "sale" || payload["source"] === "sale" ? "Venda"
          : operationType === "writeoff" ? "Baixa"
          : operationType === "transfer" ? "Transferência"
          : payload["source"] === "receiving" || (deltaOnly !== null && deltaOnly > 0) ? "Entrada"
          : operationType === "entry" ? "Entrada"
          : /balanço/i.test(String(payload["reason"] ?? "")) ? "Balanço"
          : operationType === "adjustment" ? "Ajuste de estoque" : "Movimentação";
        const operator = typeof payload["operator"] === "string" ? { operator: payload["operator"] } : {};
        const movement: StockMovement = {
          id: operationId ? `${operationId}:${event.entity_id}` : event.event_id, operationId: operationId ?? event.event_id,
          date: typeof payload["occurredAt"] === "string" ? payload["occurredAt"] : event.created_at,
          type: movementType, productId: event.entity_id,
          productCode: typeof payload["productCode"] === "string" ? payload["productCode"] : product.code,
          productName: typeof payload["productName"] === "string" ? payload["productName"] : product.name,
          unit: payload["unit"] === "kg" ? "kg" : product.unit,
          quantity, totalValue: number(payload["totalValue"]) ?? 0,
          stockBefore, stockAfter, delta,
          ...operator,
          details: typeof payload["reason"] === "string" ? payload["reason"] : `${movementType} ${operationId ?? event.event_id}`,
        };
        next.stockMovements = upsert(next.stockMovements, movement);
      }
      continue;
    }

    if (event.category === "stock" && ["stock_operation", "stock_adjustment", "stock_writeoff", "stock_transfer"].includes(event.entity_type)) {
      const rawAdjustment = record(payload["stockAdjustment"] ?? payload["stockOperation"]);
      if (payload["operation"] === "delete") {
        if (event.entity_type === "stock_writeoff") next.stockWriteoffs = next.stockWriteoffs.filter((item) => item.id !== event.entity_id);
        else if (event.entity_type === "stock_transfer") next.stockTransfers = next.stockTransfers.filter((item) => item.id !== event.entity_id);
        else if (event.entity_type === "stock_adjustment") next.stockAdjustments = next.stockAdjustments.filter((item) => item.id !== event.entity_id);
      } else if (rawAdjustment && rawAdjustment["id"] === event.entity_id && Array.isArray(rawAdjustment["items"])) {
        if (event.entity_type === "stock_writeoff") next.stockWriteoffs = upsert(next.stockWriteoffs, rawAdjustment as unknown as State["stockWriteoffs"][number]);
        else if (event.entity_type === "stock_transfer") next.stockTransfers = upsert(next.stockTransfers, rawAdjustment as unknown as State["stockTransfers"][number]);
        else next.stockAdjustments = upsert(next.stockAdjustments, rawAdjustment as unknown as State["stockAdjustments"][number]);
      } else if (event.entity_type !== "stock_operation") throw new UnsupportedSyncEventError(event);
      // The per-product ledger events carry the authoritative balance changes.
      continue;
    }

    if (event.category === "promotions" && event.entity_type === "promotion") {
      if (payload["operation"] === "delete") {
        next.promotions = next.promotions.filter((item) => item.id !== event.entity_id);
        continue;
      }
      const rawPromotion = record(payload["promotion"]);
      if (!rawPromotion || typeof rawPromotion["id"] !== "string" || rawPromotion["id"] !== event.entity_id) {
        throw new UnsupportedSyncEventError(event);
      }
      const originalPrice = number(rawPromotion["originalPrice"]);
      const promoPrice = number(rawPromotion["promoPrice"]);
      if (originalPrice === null || promoPrice === null) throw new UnsupportedSyncEventError(event);
      const existing = next.promotions.find((item) => item.id === event.entity_id);
      const version = number(rawPromotion["version"]) ?? number(payload["version"]);
      // An older replay must never roll back a promotion already applied at a newer version.
      if (version !== null && existing?.version !== undefined && version < existing.version) continue;
      next.promotions = upsert(next.promotions, {
        id: rawPromotion["id"],
        productId: String(rawPromotion["productId"] ?? ""),
        productName: String(rawPromotion["productName"] ?? ""),
        originalPrice,
        promoPrice,
        startsAt: typeof rawPromotion["startsAt"] === "string" ? rawPromotion["startsAt"] : "",
        endsAt: typeof rawPromotion["endsAt"] === "string" ? rawPromotion["endsAt"] : "",
        ...(version !== null ? { version } : existing?.version !== undefined ? { version: existing.version } : {}),
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
