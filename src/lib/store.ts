import { useSyncExternalStore } from "react";
import { subscribeToTenantEvents } from "@/lib/neon-realtime";
import { SyncOutbox, createSyncCommand, runIncrementalSync } from "@/lib/sync-outbox";
import { applySyncEventsToState, UnsupportedSyncEventError } from "@/lib/sync-event-apply";

export type Product = { id: string; version?: number; code: string; barcodes?: string[]; ref?: string | undefined; name: string; price: number; cost?: number | undefined; stock: number; minStock: number; category: string; unit: "un" | "kg"; photo?: string | undefined; photoObjectKey?: string | undefined };
export type Promotion = { id: string; productId: string; productName: string; originalPrice: number; promoPrice: number; startsAt: string; endsAt: string; version?: number; updatedAt?: string; eventId?: string };
export type PromotionEvent = { event_id: string; sequence: string; entity_id: string; payload: { operation?: "create" | "update" | "delete"; promotionId?: string; version?: number; promotion?: Record<string, unknown> }; created_at: string };
export type CartItem = { productId: string; qty: number };
export type Payment = "Dinheiro" | "Cartão" | "Pix" | "Fiado";
export type AppSettings = { companyName: string; companyCnpj?: string | undefined; companyPhone?: string | undefined; companyStreet?: string | undefined; companyNumber?: string | undefined; companyCep?: string | undefined; companyComplement?: string | undefined; companyNeighborhood?: string | undefined; companyCity?: string | undefined; companyState?: string | undefined; companyLogo?: string | undefined; companyLogoObjectKey?: string | undefined; pixKey?: string | undefined; pixKeyType?: "telefone" | "cpf" | "cnpj" | "email" | "aleatoria" | undefined };
export type FiadoPayment = { value: number; date: string };
export type Sale = { id: string; date: string; cashSessionId?: string; items: { productId?: string; name: string; price: number; cost?: number | undefined; qty: number; unit?: "un" | "kg" | undefined }[]; total: number; profit?: number; subtotal?: number; discount?: number; discountType?: "R$" | "%"; payment: Payment; received?: number | undefined; customer?: string | undefined; cpf?: string | undefined; seller?: string | undefined; paid?: boolean; paidAt?: string | undefined; payments?: FiadoPayment[] | undefined; hiddenFromFiado?: boolean };
export type ReceivingItem = { productId: string; name: string; expected: number; received?: number | undefined; expiry?: string | undefined; unit: "un" | "kg" };
export type Supplier = { name: string; cnpj?: string | undefined };
export type BusinessContact = { id: string; type: "Fornecedor" | "Cliente"; name: string; document?: string; phone?: string; cep?: string; street?: string; number?: string; neighborhood?: string; city?: string; state?: string };
export type ReceivingExtra = { productId: string; name: string; received: number; expiry?: string; unit: "un" | "kg" };
export type ReceivingNote = {
  id: string;
  number: string;
  supplier: string;
  supplierCnpj?: string | undefined;
  date: string;
  items: ReceivingItem[];
  extras?: ReceivingExtra[];
  status: "pendente" | "analisando" | "conferido" | "divergente" | "aceito" | "rejeitado";
  decisions?: Record<string, "aceitar" | "devolver">;
  decisionCompleted?: boolean;
  actionCompleted?: boolean;
  stockReleased?: boolean;
  source?: "manual";
};
export type StockAdjustmentItem = { productId: string; code: string; ref?: string; name: string; unit: "un" | "kg"; mode: "somar" | "definir"; quantity: number; previousStock: number; newStock: number };
export type StockAdjustment = { id: string; date: string; reason: string; operator?: string | undefined; items: StockAdjustmentItem[] };
export type StockWriteoffItem = { productId: string; code: string; ref?: string; name: string; unit: "un" | "kg"; quantity: number; previousStock: number; newStock: number; costMode: "compra" | "venda" | "media"; unitCost: number; totalCost: number };
export type StockWriteoff = { id: string; number: string; date: string; reason: "Perda" | "Consumo" | "Doação"; donationDestination?: string | undefined; costMode: "compra" | "venda" | "media"; operator?: string | undefined; items: StockWriteoffItem[]; document?: any; accessKey?: string };
export type StockTransfer = { id: string; number: string; date: string; reason: "Transferência de produtos, Vendas"; destinationName: string; destinationDocument?: string | undefined; destinationPhone?: string | undefined; destinationStreet?: string | undefined; destinationNumber?: string | undefined; destinationCep?: string | undefined; destinationNeighborhood?: string | undefined; destinationCity?: string | undefined; destinationState?: string | undefined; costMode: "compra" | "venda" | "media"; operator?: string | undefined; items: StockWriteoffItem[]; document?: any; accessKey?: string };
type CashSession = { id: string; openedAt: string; openedBy: string; operatorUsername?: string | undefined; openingAmount: number; status: "open" | "closed"; closedAt?: string | undefined; closedBy?: string | undefined; countedCash?: number | undefined; expectedCash?: number | undefined; difference?: number | undefined; note?: string | undefined };
export type CashMovement = { id: string; sessionId: string; type: "sangria" | "reforco"; amount: number; reason: string; operator: string; date: string };
export type Conference = {
  id: string;
  name: string;
  date: string;
  status: "aberta" | "finalizada";
  counts: Record<string, number>;
  unknown: string[];
  adjusted?: boolean;
  receivingId?: string;
  expiries?: Record<string, string>;
  extraCounts?: Record<string, number>;
  extraExpiries?: Record<string, string>;
};

type ManualExpiry = { id: string; productId: string; name: string; quantity: number; expiry: string; unit: "un" | "kg" };
export type StockMovement = { id: string; operationId: string; date: string; type: string; productId: string; productCode?: string | undefined; productName: string; unit: "un" | "kg"; quantity: number; totalValue: number; stockBefore: number; stockAfter: number; delta: number; operator?: string | undefined; details?: string | undefined; legacy?: boolean };
export type State = { contacts: BusinessContact[]; products: Product[]; cart: CartItem[]; sales: Sale[]; stockMovements: StockMovement[]; cashSessions: CashSession[]; cashMovements: CashMovement[]; conferences: Conference[]; receiving: ReceivingNote[]; manualExpiries: ManualExpiry[]; stockAdjustments: StockAdjustment[]; stockWriteoffs: StockWriteoff[]; stockTransfers: StockTransfer[]; promotions: Promotion[]; suppliers: Supplier[]; settings: AppSettings };

const KEY = "mobflow:v1";
const tenantStateKey = (tenantId: string) => `${KEY}:${tenantId}`;
let activeStateKey = KEY;
const OWNER_KEY = "mobflow:owner";
const OUTBOX_BACKUP_KEY = "mobflow:sync-outbox-backup";
const uid = () => Math.random().toString(36).slice(2, 10);
const currentOperator = () => typeof window !== "undefined" ? sessionStorage.getItem("mobflow-username")?.trim() || undefined : undefined;
const movementEntry = (input: Omit<StockMovement, "id" | "operator"> & { id?: string; operator?: string }): StockMovement => ({ ...input, id: input.id ?? uid(), operator: input.operator ?? currentOperator() });

const emptyState = (): State => ({
  contacts: [],
  products: [],
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
  settings: { companyName: "" },
});

let state: State = emptyState();
let receivingDraftPersistTimer: ReturnType<typeof setTimeout> | null = null;
let loaded = false;
let cloudReady = false;
let hydrating: Promise<void> | null = null;
let realtimeOwnerId: string | null = null;
let cloudAccountId: string | null = null;
let lastCloudUpdatedAt: string | null = null;
let lastSyncedState: State | null = null;
let persistQueue: Promise<void> = Promise.resolve();
let persistRequested = false;
let persistWorker: Promise<void> | null = null;
let stopRealtimeSubscription: (() => void) | null = null;
let syncFallbackInFlight = false;
let syncInFlight: Promise<{ sent: number; failed: number; pending: number; applied: number; cursor: string; hasMore: boolean; reconciliationRequired?: boolean }> | null = null;
let syncRefreshPending = false;
let refreshAfterPersist = false;
let syncWakeListenersInstalled = false;
let realtimeReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let realtimeCatchupTimer: ReturnType<typeof setInterval> | null = null;
// Incremented whenever a cloud event arrives while a persistence request is in flight.
let realtimeRevision = 0;
const listeners = new Set<() => void>();
const syncOutbox = new SyncOutbox();
let lastDomainCommandPromise: Promise<void> | null = null;
// Keep the command cutover fail-closed until the Neon snapshot bootstrap has relational projections.
const incrementalSyncEnabled = () =>
  import.meta.env["VITE_MOBFLOW_INCREMENTAL_SYNC"] === "true" &&
  import.meta.env["VITE_MOBFLOW_INCREMENTAL_BOOTSTRAP_READY"] === "true";

const cloneState = (value: State): State => JSON.parse(JSON.stringify(value));
const isCashSessionForOperator = (session: CashSession, username: string) => {
  const expected = username.trim().toLocaleLowerCase();
  return !!expected && (session.operatorUsername?.trim().toLocaleLowerCase() === expected || session.openedBy.trim().toLocaleLowerCase() === expected);
};

function mergeConcurrentState(base: State | null, local: State, remote: State): State {
  const mergeById = <T extends { id: string }>(left: T[], right: T[]) => {
    const map = new Map(right.map((x) => [x.id, x]));
    for (const item of left) if (!map.has(item.id)) map.set(item.id, item);
    return Array.from(map.values());
  };
  if (!base) return { ...remote, ...local, products: local.products, sales: mergeById(local.sales, remote.sales), stockMovements: mergeById(local.stockMovements ?? [], remote.stockMovements ?? []), conferences: mergeById(local.conferences ?? [], remote.conferences ?? []), receiving: mergeById(local.receiving ?? [], remote.receiving ?? []), manualExpiries: mergeById(local.manualExpiries ?? [], remote.manualExpiries ?? []), stockAdjustments: mergeById(local.stockAdjustments ?? [], remote.stockAdjustments ?? []), stockWriteoffs: mergeById(local.stockWriteoffs ?? [], remote.stockWriteoffs ?? []), stockTransfers: mergeById(local.stockTransfers ?? [], remote.stockTransfers ?? []), promotions: mergeById(local.promotions ?? [], remote.promotions ?? []), cashSessions: mergeById(local.cashSessions ?? [], remote.cashSessions ?? []), cashMovements: mergeById(local.cashMovements ?? [], remote.cashMovements ?? []), suppliers: remote.suppliers ?? local.suppliers };
  const stockMovements = mergeById(local.stockMovements ?? [], remote.stockMovements ?? []);
  const baseMovementIds = new Set((base.stockMovements ?? []).map((movement) => movement.id));
  const newMovementDeltas = new Map<string, number>();
  for (const movement of stockMovements) {
    if (movement.legacy || baseMovementIds.has(movement.id)) continue;
    newMovementDeltas.set(movement.productId, (newMovementDeltas.get(movement.productId) ?? 0) + movement.delta);
  }
  const products = remote.products.map((rp) => {
    const bp = base.products.find((p) => p.id === rp.id);
    const lp = local.products.find((p) => p.id === rp.id);
    if (!lp || !bp) return rp;
    const movementDelta = newMovementDeltas.get(rp.id);
    if (movementDelta !== undefined) return { ...rp, stock: Math.round((bp.stock + movementDelta) * 1000) / 1000 };
    const localStockChanged = lp.stock !== bp.stock;
    const remoteStockChanged = rp.stock !== bp.stock;
    if (localStockChanged && remoteStockChanged) {
      // The same stock update can arrive through both local state and Realtime.
      // If both sides already have the same value, use the server value instead
      // of applying the identical delta twice.
      if (lp.stock === rp.stock) return rp;
      return { ...rp, stock: Math.round((bp.stock + (lp.stock - bp.stock) + (rp.stock - bp.stock)) * 1000) / 1000 };
    }
    if (localStockChanged && !remoteStockChanged) return lp;
    return rp;
  });
  // In Neon catalog mode, the relational tenant catalog is authoritative. Never resurrect
  // cached products that are absent from the server response (including products deleted
  // from this company or left in an old full-state snapshot).
  if (import.meta.env["VITE_MOBFLOW_CATALOG_READ_PROVIDER"] !== "neon") {
    for (const lp of local.products) if (!remote.products.some((p) => p.id === lp.id)) products.push(lp);
  }
  return {
    ...remote,
    products,
    stockMovements,
    sales: mergeById(local.sales, remote.sales),
    cashSessions: mergeById(local.cashSessions ?? [], remote.cashSessions ?? []),
    cashMovements: mergeById(local.cashMovements ?? [], remote.cashMovements ?? []),
    conferences: mergeById(local.conferences, remote.conferences),
    receiving: mergeById(local.receiving, remote.receiving),
    manualExpiries: mergeById(local.manualExpiries ?? [], remote.manualExpiries ?? []),
    stockAdjustments: mergeById(local.stockAdjustments ?? [], remote.stockAdjustments ?? []),
    stockWriteoffs: mergeById(local.stockWriteoffs ?? [], remote.stockWriteoffs ?? []),
    stockTransfers: mergeById(local.stockTransfers ?? [], remote.stockTransfers ?? []),
    promotions: mergeById(local.promotions ?? [], remote.promotions ?? []),
    contacts: (() => { const map = new Map((remote.contacts ?? []).map((c) => [c.id, c])); for (const c of local.contacts ?? []) if (!map.has(c.id)) map.set(c.id, c); return Array.from(map.values()); })(),
    suppliers: (() => {
      const map = new Map(remote.suppliers.map((s) => [s.name.toLowerCase(), s]));
      for (const s of local.suppliers) if (!map.has(s.name.toLowerCase())) map.set(s.name.toLowerCase(), s);
      return Array.from(map.values());
    })(),
    cart: local.cart,
    settings: local.settings,
  };
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(activeStateKey);
    if (raw) state = { ...state, ...JSON.parse(raw) };
    // In Neon catalog mode, localStorage is only a cache for secondary/offline state.
    // Never expose cached products before the authenticated tenant catalog has loaded:
    // the legacy app_state snapshot can contain products no longer present in public.products.
    if (import.meta.env["VITE_MOBFLOW_CATALOG_READ_PROVIDER"] === "neon") {
      state.products = [];
      // The cart is a tenant-scoped local draft: keep it through refreshes and
      // validate each product ID only after the authoritative Neon catalog is loaded.
    }
    state.products = state.products.map((p) => ({ ...p, unit: p.unit === "kg" ? "kg" : "un" }));
    normalizeState();
  } catch {}
}
function normalizeState() {
  state.contacts = Array.isArray(state.contacts) ? state.contacts : [];
  state.products = Array.isArray(state.products) ? state.products : [];
  state.cart = Array.isArray(state.cart) ? state.cart : [];
  state.sales = Array.isArray(state.sales) ? state.sales : [];
  state.cashSessions = Array.isArray(state.cashSessions) ? state.cashSessions : [];
  state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
  state.conferences = Array.isArray(state.conferences) ? state.conferences : [];
  state.receiving = Array.isArray(state.receiving) ? state.receiving : [];
  state.manualExpiries = Array.isArray(state.manualExpiries) ? state.manualExpiries : [];
  state.stockAdjustments = Array.isArray(state.stockAdjustments) ? state.stockAdjustments : [];
  state.stockWriteoffs = Array.isArray(state.stockWriteoffs) ? state.stockWriteoffs : [];
  state.stockTransfers = Array.isArray(state.stockTransfers) ? state.stockTransfers : [];
  state.promotions = Array.isArray(state.promotions) ? state.promotions : [];
  state.suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
  state.stockMovements = Array.isArray(state.stockMovements) ? state.stockMovements : [];
  // Build a read-only bridge for historical operations created before the ledger existed.
  // Legacy rows are explicitly marked so they never participate in stock delta reconciliation.
  const knownMovementIds = new Set(state.stockMovements.map((movement) => movement.id));
  const hasRelationalLegacyMovement = (operationId: string, productId: string) =>
    state.stockMovements.some((movement) => movement.operationId === operationId && movement.productId === productId);
  const legacyCandidates: StockMovement[] = [];
  for (const sale of state.sales) {
    if (state.stockMovements.some((movement) => movement.operationId === sale.id && !movement.legacy)) continue;
    (sale.items ?? []).forEach((item, index) => {
      const product = state.products.find((p) => p.id === item.productId) ?? state.products.find((p) => p.name.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase());
      const productId = product?.id ?? `legacy-product:${item.name.trim().toLocaleLowerCase()}`;
      if (hasRelationalLegacyMovement(sale.id, productId)) return;
      const id = `legacy:sale:${sale.id}:${productId}:${index}`;
      if (knownMovementIds.has(id)) return;
      legacyCandidates.push({ id, operationId: sale.id, date: sale.date, type: "Venda", productId, productCode: product?.code, productName: item.name, unit: item.unit === "kg" ? "kg" : product?.unit ?? "un", quantity: item.qty, totalValue: Math.round(item.price * item.qty * 100) / 100, stockBefore: 0, stockAfter: 0, delta: -item.qty, operator: sale.seller, details: `Venda histórica ${sale.id}`, legacy: true });
    });
  }
  for (const adjustment of state.stockAdjustments) {
    if (state.stockMovements.some((movement) => movement.operationId === adjustment.id && !movement.legacy)) continue;
    for (const item of adjustment.items) {
      if (hasRelationalLegacyMovement(adjustment.id, item.productId)) continue;
      const id = `legacy:adjustment:${adjustment.id}:${item.productId}`;
      if (knownMovementIds.has(id)) continue;
      const delta = item.newStock - item.previousStock;
      legacyCandidates.push({ id, operationId: adjustment.id, date: adjustment.date, type: /balanço/i.test(adjustment.reason) ? "Balanço" : "Ajuste de estoque", productId: item.productId, productCode: item.code, productName: item.name, unit: item.unit, quantity: Math.abs(delta), totalValue: Math.round(Math.abs(delta) * (state.products.find((p) => p.id === item.productId)?.price ?? 0) * 100) / 100, stockBefore: item.previousStock, stockAfter: item.newStock, delta, operator: adjustment.operator, details: adjustment.reason, legacy: true });
    }
  }
  for (const writeoff of state.stockWriteoffs) {
    if (state.stockMovements.some((movement) => movement.operationId === writeoff.id && !movement.legacy)) continue;
    for (const item of writeoff.items) {
      if (hasRelationalLegacyMovement(writeoff.id, item.productId)) continue;
      const id = `legacy:writeoff:${writeoff.id}:${item.productId}`;
      if (knownMovementIds.has(id)) continue;
      legacyCandidates.push({ id, operationId: writeoff.id, date: writeoff.date, type: "Baixa", productId: item.productId, productCode: item.code, productName: item.name, unit: item.unit, quantity: item.quantity, totalValue: item.totalCost, stockBefore: item.previousStock, stockAfter: item.newStock, delta: item.newStock - item.previousStock, operator: writeoff.operator, details: `${writeoff.number} · ${writeoff.reason}`, legacy: true });
    }
  }
  for (const transfer of state.stockTransfers) {
    if (state.stockMovements.some((movement) => movement.operationId === transfer.id && !movement.legacy)) continue;
    for (const item of transfer.items) {
      if (hasRelationalLegacyMovement(transfer.id, item.productId)) continue;
      const id = `legacy:transfer:${transfer.id}:${item.productId}`;
      if (knownMovementIds.has(id)) continue;
      legacyCandidates.push({ id, operationId: transfer.id, date: transfer.date, type: "Transferência", productId: item.productId, productCode: item.code, productName: item.name, unit: item.unit, quantity: item.quantity, totalValue: item.totalCost, stockBefore: item.previousStock, stockAfter: item.newStock, delta: item.newStock - item.previousStock, operator: transfer.operator, details: `${transfer.number} · Destino: ${transfer.destinationName}`, legacy: true });
    }
  }
  for (const note of state.receiving) {
    if (!note.stockReleased || state.stockMovements.some((movement) => movement.operationId === note.id && !movement.legacy)) continue;
    const lines = [...note.items, ...(note.extras ?? [])];
    const totals = new Map<string, { quantity: number; name: string; unit: "un" | "kg" }>();
    for (const line of lines) {
      if (note.decisions && note.decisions[line.productId] === "devolver") continue;
      const quantity = "received" in line ? (line.received ?? ("expected" in line ? line.expected : 0)) : 0;
      if (quantity <= 0) continue;
      const previous = totals.get(line.productId);
      totals.set(line.productId, { quantity: (previous?.quantity ?? 0) + quantity, name: line.name, unit: line.unit });
    }
    for (const [productId, line] of totals) {
      if (hasRelationalLegacyMovement(note.id, productId)) continue;
      const id = `legacy:receiving:${note.id}:${productId}`;
      if (knownMovementIds.has(id)) continue;
      const product = state.products.find((p) => p.id === productId);
      legacyCandidates.push({ id, operationId: note.id, date: note.date, type: "Recebimento", productId, productCode: product?.code, productName: line.name, unit: line.unit, quantity: line.quantity, totalValue: Math.round(line.quantity * (product?.price ?? 0) * 100) / 100, stockBefore: 0, stockAfter: 0, delta: line.quantity, details: `Nota ${note.number} · ${note.supplier}`, legacy: true });
    }
  }
  // Reconstruct missing legacy stock snapshots backwards from the current product balance.
  const legacyByProduct = new Map<string, StockMovement[]>();
  for (const movement of legacyCandidates) legacyByProduct.set(movement.productId, [...(legacyByProduct.get(movement.productId) ?? []), movement]);
  for (const [productId, movements] of legacyByProduct) {
    const product = state.products.find((p) => p.id === productId);
    let runningStock = product?.stock ?? 0;
    for (const movement of movements.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())) {
      if (movement.stockBefore === 0 && movement.stockAfter === 0) {
        movement.stockAfter = runningStock;
        movement.stockBefore = Math.round((runningStock - movement.delta) * 1000) / 1000;
      }
      runningStock = Math.round((runningStock - movement.delta) * 1000) / 1000;
    }
  }
  state.stockMovements = [...legacyCandidates, ...state.stockMovements].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  state.cashSessions = Array.isArray(state.cashSessions) ? state.cashSessions : [];
  state.cashMovements = Array.isArray(state.cashMovements) ? state.cashMovements : [];
  state.conferences = Array.isArray(state.conferences) ? state.conferences : [];
  state.receiving = Array.isArray(state.receiving) ? state.receiving : [];
  state.manualExpiries = Array.isArray(state.manualExpiries) ? state.manualExpiries : [];
  state.stockAdjustments = Array.isArray(state.stockAdjustments) ? state.stockAdjustments : [];
  state.stockWriteoffs = Array.isArray(state.stockWriteoffs) ? state.stockWriteoffs : [];
  state.stockTransfers = Array.isArray(state.stockTransfers) ? state.stockTransfers : [];
  state.promotions = Array.isArray(state.promotions) ? state.promotions : [];
  const legacyManual = state.receiving.filter((n) => n.source === "manual");
  if (legacyManual.length) {
    const knownIds = new Set(state.manualExpiries.map((e) => e.id));
    state.manualExpiries = [...state.manualExpiries, ...legacyManual.filter((n) => !knownIds.has(n.id)).flatMap((n) => n.items.filter((i) => !!i.expiry).map((i) => ({ id: n.id, productId: i.productId, name: i.name, quantity: i.received ?? i.expected, expiry: i.expiry!, unit: i.unit })))];
    state.receiving = state.receiving.filter((n) => n.source !== "manual");
  }
  state.suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
  state.settings = state.settings && typeof state.settings === "object"
    ? state.settings
    : { companyName: "" };
  // Keep the company name as the visible caption, but do not store an embedded
  // image in the shared state. A multi-megabyte base64 logo made every cloud
  // write time out and blocked stock movement synchronization.
  delete state.settings.companyLogo;
}

type MobFlowApiBody = {
  ok?: boolean;
  accountId?: string;
  state?: unknown;
  updatedAt?: string | null;
  syncCursor?: string;
  privateContactIds?: string[];
  record?: unknown;
  promotions?: unknown;
  events?: unknown;
  promotion?: unknown;
  ids?: unknown[];
  status?: string;
  remoteState?: unknown;
  remoteUpdatedAt?: string | null;
  error?: string;
  products?: unknown;
  hasMore?: unknown;
  nextCursor?: unknown;
  session?: unknown;
  data?: unknown;
};

async function callMobFlowApi(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const body = await response.json().catch(() => ({})) as MobFlowApiBody;
  return { response, body };

}
async function loadPrivateData(contactIds: string[] = []) {
  const settingsResult = await callMobFlowApi("/api/mobflow/private-data?kind=settings");
  if (!settingsResult.response.ok || settingsResult.body.ok !== true) throw new Error("Não foi possível recuperar as configurações privadas.");
  const contacts = await Promise.all(contactIds.map(async (id) => {
    const result = await callMobFlowApi("/api/mobflow/private-data?kind=contact&id=" + encodeURIComponent(id));
    if (!result.response.ok || result.body.ok !== true || !result.body.record) throw new Error("Não foi possível recuperar um contato da empresa.");
    return result.body.record as BusinessContact;
  }));
  return { contacts, settings: settingsResult.body.record as AppSettings };
}
async function savePrivateRecord(kind: "contact" | "settings", id: string | undefined, value: Record<string, unknown>) {
  const result = await callMobFlowApi("/api/mobflow/private-data?kind=" + kind, { method: "PATCH", body: JSON.stringify({ id, value }) });
  if (!result.response.ok || result.body.ok !== true) throw new Error(String(result.body.error ?? "Falha ao salvar dados privados."));
  return result.body.record;
}
async function removePrivateContact(id: string) {
  const result = await callMobFlowApi("/api/mobflow/private-data?kind=contact&id=" + encodeURIComponent(id), { method: "DELETE" });
  if (!result.response.ok || result.body.ok !== true) throw new Error(String(result.body.error ?? "Falha ao excluir contato."));
}
async function persistReceivingRecord(note: ReceivingNote) {
  const result = await callMobFlowApi("/api/mobflow/receiving", { method: "POST", body: JSON.stringify({ action: "save", note }) });
  if (!result.response.ok || result.body.ok !== true) throw new Error(String(result.body.error ?? "Falha ao salvar recebimento."));
}
async function deleteReceivingRecord(id: string) {
  const result = await callMobFlowApi("/api/mobflow/receiving", { method: "POST", body: JSON.stringify({ action: "delete", receivingId: id }) });
  if (!result.response.ok || result.body.ok !== true) throw new Error(String(result.body.error ?? "Falha ao excluir recebimento."));
}
async function persistReceivingConference(conference: Conference) {
  const result = await callMobFlowApi("/api/mobflow/receiving", { method: "POST", body: JSON.stringify({ action: "save_conference", conference }) });
  if (!result.response.ok || result.body.ok !== true) throw new Error(String(result.body.error ?? "Falha ao salvar conferência do recebimento."));
}

function readOutboxBackup(): import("@/lib/sync-outbox").SyncCommand[] {
  try {
    const value = JSON.parse(localStorage.getItem(OUTBOX_BACKUP_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function writeOutboxBackup(commands: import("@/lib/sync-outbox").SyncCommand[]) {
  try {
    if (commands.length) localStorage.setItem(OUTBOX_BACKUP_KEY, JSON.stringify(commands));
    else localStorage.removeItem(OUTBOX_BACKUP_KEY);
    return true;
  } catch { return false; }
}

async function restoreOutboxBackup(tenantId: string) {
  const commands = readOutboxBackup();
  const remaining: import("@/lib/sync-outbox").SyncCommand[] = [];
  for (const command of commands) {
    if (command.tenantId !== tenantId) { remaining.push(command); continue; }
    try { await syncOutbox.enqueue(command); }
    catch { remaining.push(command); }
  }
  writeOutboxBackup(remaining);
}

function enqueueDomainCommand(domain: "sales" | "cash" | "stock", payload: Record<string, unknown>): boolean {
  if (typeof window === "undefined") return false;
  // Until incremental events are approved, critical operations go straight to
  // their transactional Neon endpoints. They are never treated as completed
  // merely because they were placed in the local outbox.
  if (!incrementalSyncEnabled()) {
    const idempotencyKey = typeof payload["idempotencyKey"] === "string"
      ? String(payload["idempotencyKey"])
      : crypto.randomUUID();
    const body = { ...payload, idempotencyKey };
    const endpoint = domain === "cash" ? "/api/mobflow/cash" : domain === "sales" ? "/api/mobflow/sales" : "/api/mobflow/stock";
    lastDomainCommandPromise = (async () => {
      const result = await callMobFlowApi(endpoint, { method: "POST", body: JSON.stringify(body) });
      if (!result.response.ok || result.body.ok !== true) {
        throw new Error(String(result.body.error ?? "O Neon não confirmou a operação."));
      }
      // The relational transaction is the source of truth. Refresh the
      // snapshot after commit so the UI uses the server-generated values.
      await hydrateStore().catch(() => undefined);
    })();
    void lastDomainCommandPromise.catch((error) => console.warn("[MobFlow Neon] Operation was not confirmed:", error));
    return true;
  }
  const tenantId = cloudAccountId ?? localStorage.getItem(OWNER_KEY);
  if (!tenantId) return false;
  try {
    const command = createSyncCommand({ tenantId, domain, payload });
    // Persist synchronously before exposing the optimistic UI state.
    const backup = readOutboxBackup().filter((item) => item.id !== command.id);
    if (!writeOutboxBackup([...backup, command])) return false;
    lastDomainCommandPromise = syncOutbox.enqueue(command).then(async () => {
      writeOutboxBackup(readOutboxBackup().filter((item) => item.id !== command.id));
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("Sem conexão. A operação ficou pendente e ainda não foi confirmada pelo servidor.");
      }
      const result = await syncNow();
      if (result.failed > 0 || result.pending > 0) {
        throw new Error("O servidor ainda não confirmou a operação. Ela permanece na fila para nova tentativa.");
      }
    });
    void lastDomainCommandPromise.catch((error) => {
      console.warn("[MobFlow Sync] Server confirmation pending; command retained in outbox.", error);
    });
    return true;
  } catch (error) {
    console.error("[MobFlow Sync] Could not create command; operation was not sent.", error);
    return false;
  }
}

/** Waits for the most recently queued domain operation to be committed by Neon. */
export async function confirmLastDomainCommand(): Promise<void> {
  const pending = lastDomainCommandPromise;
  lastDomainCommandPromise = null;
  if (!pending) throw new Error("A operação não entrou na fila de sincronização e não foi enviada ao servidor.");
  await pending;
}

async function readPreviewNeonCatalog(fallbackProducts: Product[]): Promise<Product[]> {
  if (import.meta.env["VITE_MOBFLOW_CATALOG_READ_PROVIDER"] !== "neon") return fallbackProducts;
  try {
    const products: Product[] = [];
    const existing = new Map(fallbackProducts.map((product) => [product.id, product]));
    let cursor: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({ limit: "100" });
      if (cursor) query.set("cursor", cursor);
      const { response, body } = await callMobFlowApi("/api/mobflow/products?" + query.toString());
      if (!response.ok || !Array.isArray(body.products)) {
        console.error("[MobFlow Catalog] Neon catalog request failed; refusing to show cached products from an unverified tenant catalog.");
        return [];
      }
      for (const raw of body.products as any[]) {
        const previous = existing.get(String(raw.id));
        products.push({ id: String(raw.id), version: Number(raw.version ?? 1), code: String(raw.code ?? ""),
          barcodes: Array.isArray(raw.barcodes) ? raw.barcodes.map(String) : [],
          ref: typeof raw.ref === "string" ? raw.ref : undefined, name: String(raw.name ?? ""),
          price: Number(raw.price ?? 0), cost: Number(raw.cost ?? 0), stock: Number(raw.stock ?? 0),
          minStock: Number(raw.minStock ?? 0), category: String(raw.category ?? ""),
          unit: raw.unit === "kg" ? "kg" : "un", photoObjectKey: typeof raw.photoObjectKey === "string" ? raw.photoObjectKey : undefined, photo: typeof raw.photoObjectKey === "string" ? `/api/mobflow/product-photo?productId=${encodeURIComponent(String(raw.id))}` : previous?.photo });
      }
      if (body.hasMore !== true) return products;
      if (typeof body.nextCursor !== "string" || !body.nextCursor) {
        console.error("[MobFlow Catalog] Neon catalog pagination returned an invalid cursor; refusing cached catalog fallback.");
        return [];
      }
      cursor = body.nextCursor;
    }
    console.error("[MobFlow Catalog] Neon catalog exceeded the safe pagination limit; refusing cached catalog fallback.");
    return [];
  } catch (error) {
    console.error("[MobFlow Catalog] Could not load the authoritative Neon catalog:", error);
    return [];
  }
}

async function refreshFromCloud(accountId: string, forceLatest = false) {
  if (persistWorker && cloudReady && cloudAccountId === accountId) {
    refreshAfterPersist = true;
    return;
  }
  if (
    typeof window === "undefined" ||
    !cloudReady ||
    cloudAccountId !== accountId ||
    syncFallbackInFlight
  ) return;

  syncFallbackInFlight = true;
  try {
    const { response, body } = await callMobFlowApi("/api/mobflow/state");
    if (!response.ok || !body.state || typeof body.state !== "object") return;

    if (!cloudReady || cloudAccountId !== accountId || persistWorker) {
      if (persistWorker && cloudReady && cloudAccountId === accountId) refreshAfterPersist = true;
      return;
    }

    const remoteUpdatedAt = typeof body.updatedAt === "string" ? body.updatedAt : null;
    if (!remoteUpdatedAt) return;
    const remoteTime = Date.parse(remoteUpdatedAt);
    const currentTime = lastCloudUpdatedAt ? Date.parse(lastCloudUpdatedAt) : Number.NaN;
    if (Number.isFinite(currentTime) && Number.isFinite(remoteTime) && (forceLatest ? remoteTime < currentTime : remoteTime <= currentTime)) return;

    const remote = body.state as State;
    state = mergeConcurrentState(lastSyncedState, state, remote);
    state.products = await readPreviewNeonCatalog(state.products ?? remote.products ?? []);
    state.cart = (state.cart ?? []).filter((item) => state.products.some((product) => product.id === item.productId));
    lastSyncedState = cloneState(remote);
    lastCloudUpdatedAt = remoteUpdatedAt;
    if (typeof body.syncCursor === "string") await syncOutbox.setCursor(accountId, body.syncCursor);
    realtimeRevision += 1;
    try { localStorage.setItem(activeStateKey, JSON.stringify(state)); } catch {}
    listeners.forEach((listener) => listener());
  } catch {
    // A próxima reconexão, foco da janela ou retorno da conexão recupera a sincronização.
  } finally {
    syncFallbackInFlight = false;
    if (syncRefreshPending) {
      syncRefreshPending = false;
      void refreshFromCloud(accountId, true);
    }
  }
}

function reconnect() {
  const accountId = cloudAccountId;
  if (!accountId || realtimeReconnectTimer) return;
  realtimeReconnectTimer = setTimeout(() => {
    realtimeReconnectTimer = null;
    if (cloudAccountId === accountId && !stopRealtimeSubscription) {
      realtimeOwnerId = null;
      startRealtime(accountId);
    }
  }, 3_000);
}

function startRealtime(accountId: string) {
  if (typeof window === "undefined") return;
  if (realtimeOwnerId !== accountId) {
    stopRealtimeSubscription?.();
    stopRealtimeSubscription = null;
    realtimeOwnerId = accountId;
  } else if (stopRealtimeSubscription) {
    return;
  }

  if (!syncWakeListenersInstalled) {
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible" || !cloudAccountId) return;
      void syncNow().catch(() => undefined);
      if (!stopRealtimeSubscription) {
        realtimeOwnerId = null;
        startRealtime(cloudAccountId);
      }
    };
    const refreshWhenOnline = () => {
      if (!cloudAccountId) return;
      void syncNow().catch(() => undefined);
      if (!stopRealtimeSubscription) {
        realtimeOwnerId = null;
        startRealtime(cloudAccountId);
      }
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenOnline);
    syncWakeListenersInstalled = true;
  }

  // Realtime is only a wake-up signal; the client drains the durable outbox and pulls events by cursor.
  void subscribeToTenantEvents(
    () => {
      if (incrementalSyncEnabled()) {
        void syncNow().catch((error) => console.warn("[MobFlow Sync] Realtime pull deferred:", error));
      } else {
        // Compatibility mode: only a new Neon event wakes this refresh.
        // There is deliberately no three-second full-state polling loop.
        void refreshFromCloud(accountId, true);
      }
    },
    (message) => {
      console.warn("[MobFlow Realtime] Subscription stopped:", message);
      stopRealtimeSubscription?.();
      stopRealtimeSubscription = null;
      realtimeOwnerId = null;
      reconnect();
    },
  ).then((stop) => {
    if (realtimeOwnerId !== accountId || cloudAccountId !== accountId) {
      stop();
      return;
    }
    stopRealtimeSubscription = stop;
  }).catch((error) => {
    console.warn("[MobFlow Realtime] Could not start subscription:", error instanceof Error ? error.message : "unknown");
    realtimeOwnerId = null;
    reconnect();
    console.warn("[MobFlow Realtime] Reconnect scheduled; cursor catch-up remains active.");
  });
}


export async function hydrateStore() {
  if (hydrating) return hydrating;
  hydrating = (async () => {
    try {
      const contextResult = await callMobFlowApi("/api/mobflow/session-context");
      if (!contextResult.response.ok || !contextResult.body.ok || typeof contextResult.body.accountId !== "string") {
        throw new Error("Não foi possível validar a sessão no servidor MobFlow.");
      }
      const accountId = contextResult.body.accountId;
      activeStateKey = tenantStateKey(accountId);
      loaded = false;
      state = emptyState();
      load();
      const localContacts = [...(state.contacts ?? [])];
      const localCart = [...(state.cart ?? [])];
      const sameOwner = true;

      const stateResult = await callMobFlowApi("/api/mobflow/state");
      if (!stateResult.response.ok || !stateResult.body.ok) {
        throw new Error("Não foi possível carregar os dados da empresa pelo Neon.");
      }

      const remoteState = stateResult.body.state;
      if (typeof stateResult.body.syncCursor === "string") await syncOutbox.setCursor(accountId, stateResult.body.syncCursor);
      if (remoteState && typeof remoteState === "object") {
        const remote = remoteState as State;
        const remoteContacts = Array.isArray(remote.contacts) ? remote.contacts : [];
        const mergedContacts = sameOwner
          ? [...remoteContacts, ...localContacts.filter(local => !remoteContacts.some(remoteContact => remoteContact.id === local.id))]
          : remoteContacts;
        state = { ...emptyState(), ...remote, contacts: mergedContacts };
        state.settings = { ...emptyState().settings, ...(remote.settings ?? {}) };
        state.products = await readPreviewNeonCatalog(state.products ?? []);
        // The cart is a tenant-scoped local draft, not a Neon sale. Preserve it across
        // refreshes, but keep only products confirmed by the authoritative tenant catalog.
        state.cart = localCart.filter((item) => state.products.some((product) => product.id === item.productId));
        lastCloudUpdatedAt = stateResult.body.updatedAt ?? null;
        lastSyncedState = cloneState(remote);
      } else {
        state = emptyState();
        lastCloudUpdatedAt = null;
        lastSyncedState = null;
      }

      // Resolve the authenticated operator identity separately from the display name.
      // The snapshot keeps the display label; operatorUsername is the stable login key
      // used by cash actions on every device, including compatibility mode.
      try {
        const cashStatus = await callMobFlowApi("/api/mobflow/cash");
        if (cashStatus.response.ok && cashStatus.body.ok === true) {
          const remote = cashStatus.body.session as null | { id: string; status: "open"; openingAmount: number; openedAt: string; note?: string; operatorUsername: string };
          const username = sessionStorage.getItem("mobflow-username")?.trim() || "";
          if (username) {
            const retained = state.cashSessions.filter((item) => item.id !== remote?.id && !(item.status === "open" && isCashSessionForOperator(item, username)));
            const canonical: CashSession[] = remote ? [{
              id: remote.id, status: "open", openingAmount: Number(remote.openingAmount), openedAt: remote.openedAt,
              openedBy: remote.operatorUsername, operatorUsername: remote.operatorUsername,
              ...(remote.note ? { note: remote.note } : {}),
            }] : [];
            state = { ...state, cashSessions: [...canonical, ...retained] };
          }
        }
      } catch (error) {
        console.warn("[MobFlow Cash] Could not reconcile the current operator session:", error);
      }

      // Publish the authoritative Neon snapshot before loading secondary private data.
      // A contacts/settings failure must never hide persisted sales, cash sessions or stock.
      normalizeState();
      try {
        localStorage.setItem(OWNER_KEY, accountId);
        localStorage.setItem(activeStateKey, JSON.stringify(state));
      } catch {}
      listeners.forEach((listener) => listener());

      try {
        const privateData = await loadPrivateData(Array.isArray(stateResult.body.privateContactIds) ? stateResult.body.privateContactIds : []);
        state = { ...state, contacts: privateData.contacts, settings: { ...state.settings, ...privateData.settings } };
        normalizeState();
        try { localStorage.setItem(activeStateKey, JSON.stringify(state)); } catch {}
        listeners.forEach((listener) => listener());
      } catch (error) {
        // Private settings/contacts are secondary; core relational data is already loaded.
        console.error("[MobFlow Hydration] Private company data could not be loaded:", error);
      }

      cloudAccountId = accountId;
      cloudReady = true;
      startRealtime(accountId);
      // Initial synchronization uses the same incremental outbox and event-pull path as Realtime.
      void syncNow().catch((error) => console.warn("[MobFlow Sync] Initial incremental sync deferred:", error));
    } catch (error) {
      console.error("[MobFlow Hydration] Could not load the authoritative Neon state:", error);
      cloudReady = false;
      // Notify the UI so it does not silently keep presenting an empty/stale view.
      listeners.forEach((listener) => listener());
    }
  })().finally(() => { hydrating = null; });
  return hydrating;
}

function scheduleStatePersist() {
  if (!cloudReady || !cloudAccountId || typeof window === "undefined") return;
  persistRequested = true;
  if (persistWorker) return;
  const worker = (async () => {
    while (persistRequested) {
      persistRequested = false;
      const accountId = cloudAccountId;
      if (!accountId || !cloudReady) break;
      // Private contacts/settings have their own authenticated endpoint.
      // Keep only the public company caption in the shared snapshot.
      const snapshot = cloneState(state);
      snapshot.contacts = [];
      snapshot.settings = { companyName: snapshot.settings?.companyName ?? "" };
      let attempts = 0;
      let saved = false;
      while (!saved && attempts < 4) {
        attempts += 1;
        const result = await callMobFlowApi("/api/mobflow/state", {
          method: "PUT",
          body: JSON.stringify({ state: snapshot, expectedUpdatedAt: lastCloudUpdatedAt }),
        });
        if (result.response.ok && result.body.ok === true && typeof result.body.updatedAt === "string") {
          lastCloudUpdatedAt = result.body.updatedAt;
          lastSyncedState = cloneState(snapshot);
          saved = true;
          continue;
        }
        if (result.response.status === 409 && result.body.status === "conflict" &&
            result.body.remoteState && typeof result.body.remoteState === "object") {
          const remote = result.body.remoteState as State;
          lastCloudUpdatedAt = typeof result.body.remoteUpdatedAt === "string" ? result.body.remoteUpdatedAt : null;
          state = mergeConcurrentState(lastSyncedState, state, remote);
          const retrySnapshot = cloneState(state);
          retrySnapshot.contacts = [];
          retrySnapshot.settings = { companyName: retrySnapshot.settings?.companyName ?? "" };
          Object.assign(snapshot, retrySnapshot);
          lastSyncedState = cloneState(remote);
          listeners.forEach((listener) => listener());
          continue;
        }
        throw new Error(String(result.body.error ?? "Não foi possível salvar o estado completo no Neon."));
      }
      if (!saved) throw new Error("O estado mudou em outro dispositivo várias vezes. A gravação foi interrompida para evitar sobrescrita.");
      try { localStorage.setItem(activeStateKey, JSON.stringify(state)); } catch {}
      if (refreshAfterPersist) {
        refreshAfterPersist = false;
        void refreshFromCloud(accountId, true);
      }
    }
  })();
  persistWorker = worker;
  persistQueue = worker;
  void worker.catch((error) => {
    console.error("[MobFlow State] Persistência no Neon não concluída:", error);
  }).finally(() => {
    if (persistWorker === worker) persistWorker = null;
    if (persistRequested) scheduleStatePersist();
  });
}

function set(next: Partial<State>, options: { persist?: boolean } = {}) {
  state = { ...state, ...next };
  try { localStorage.setItem(activeStateKey, JSON.stringify(state)); } catch {}
  listeners.forEach((l) => l());
  if (options.persist !== false) scheduleStatePersist();
}

export async function applyIncrementalEvents(events: import("@/lib/sync-outbox").SyncEvent[]) {
  const next = applySyncEventsToState(state, events);
  state = next;
  if (events.some((event) => (event.category === "master_data" && event.entity_type === "business_contact") || (event.category === "settings" && event.entity_type === "company_settings"))) {
    const list = await callMobFlowApi("/api/mobflow/private-data?kind=contacts");
    if (!list.response.ok || list.body.ok !== true || !Array.isArray(list.body.ids)) throw new Error("Falha ao recuperar os contatos atualizados.");
    const privateData = await loadPrivateData(list.body.ids.filter((id): id is string => typeof id === "string"));
    state = { ...state, contacts: privateData.contacts, settings: { ...state.settings, ...privateData.settings } };
  }
  try { localStorage.setItem(activeStateKey, JSON.stringify(state)); } catch {}
  listeners.forEach((listener) => listener());
}

async function performSyncNow(options: { retryFailed?: boolean } = {}) {
  // Keep both the manual button and automatic wake-ups inert until the Preview flag is approved.
  if (!incrementalSyncEnabled()) {
    let tenantId = cloudAccountId;
    if (!tenantId && typeof window !== "undefined") {
      try { tenantId = localStorage.getItem(OWNER_KEY); } catch {}
    }
    if (!tenantId) return { sent: 0, failed: 0, pending: 0, applied: 0, cursor: "0", hasMore: false };
    await restoreOutboxBackup(tenantId);
    const [failed, pending, cursor] = await Promise.all([
      syncOutbox.failedCount(tenantId),
      syncOutbox.pendingCount(tenantId),
      syncOutbox.getCursor(tenantId),
    ]);
    return { sent: 0, failed, pending, applied: 0, cursor, hasMore: false };
  }

  // O botão manual também pode ser acionado antes da hidratação inicial do app.
  // Revalida a sessão no servidor e carrega o tenant antes de acessar a fila.
  if (!cloudReady || !cloudAccountId) {
    await hydrateStore();
  }
  const tenantId = cloudAccountId;
  if (!tenantId || !cloudReady) {
    throw new Error("Não foi possível validar a sessão da empresa. Entre novamente e tente sincronizar.");
  }
  if (persistWorker) await persistQueue;
  await restoreOutboxBackup(tenantId);
  if (options.retryFailed) await syncOutbox.retryFailed(tenantId);
  try {
    const result = await runIncrementalSync({
      outbox: syncOutbox,
      tenantId,
      applyEvents: (events) => applyIncrementalEvents(events),
    });
    // Reconcile this operator's open cash session against Neon, including devices
    // that missed the original event notification.
    const cashStatus = await callMobFlowApi("/api/mobflow/cash");
    if (cashStatus.response.ok && cashStatus.body.ok === true) {
      const remote = cashStatus.body.session as null | { id:string; status:"open"; openingAmount:number; openedAt:string; note?:string; operatorUsername:string };
      const username = sessionStorage.getItem("mobflow-username")?.trim() || "";
      if (username) {
        const retained = (state.cashSessions ?? []).filter((item) => item.id !== remote?.id && !(item.status === "open" && isCashSessionForOperator(item, username)));
        const canonical: CashSession[] = remote ? [{ id:remote.id, status:"open", openingAmount:Number(remote.openingAmount), openedAt:remote.openedAt, openedBy:remote.operatorUsername, operatorUsername:remote.operatorUsername, ...(remote.note ? {note:remote.note} : {}) }] : [];
        set({ cashSessions: [...canonical, ...retained] }, { persist: false });
      }
    }
    return { ...result, failed: await syncOutbox.failedCount(tenantId) };
  } catch (error) {
    if (error instanceof UnsupportedSyncEventError) {
      // Do not silently download the full company state during automatic sync.
      // The cursor remains unchanged so a manual full reconciliation can recover it.
      return {
        sent: 0, failed: await syncOutbox.failedCount(tenantId),
        pending: await syncOutbox.pendingCount(tenantId), applied: 0,
        cursor: await syncOutbox.getCursor(tenantId), hasMore: false, reconciliationRequired: true,
      };
    }
    throw error;
  }
}


/**
 * Coalesce Realtime, focus, online and command-triggered sync requests.
 * Only one cursor read/apply cycle may run for this app instance at a time.
 */
export function syncNow(options: { retryFailed?: boolean } = {}) {
  if (syncInFlight) return syncInFlight;
  const running = performSyncNow(options);
  const shared = running.finally(() => {
    if (syncInFlight === shared) syncInFlight = null;
  });
  syncInFlight = shared;
  return shared;
}

const serverState = state;
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => { load(); listeners.add(l); l(); return () => listeners.delete(l); },
    () => { load(); return sel(state); },
    () => sel(serverState),
  );
}

export function effectivePrice(product: Product, at = new Date()): number {
  const promotion = (state.promotions ?? [])
    .filter((promo) => promo.productId === product.id && new Date(promo.startsAt).getTime() <= at.getTime() && new Date(promo.endsAt).getTime() >= at.getTime())
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())[0];
  return promotion ? promotion.promoPrice : product.price;
}

export const actions = {
  openCashSession(openingAmount: number, note = "") {
    const operator = typeof window !== "undefined" ? sessionStorage.getItem("mobflow-username")?.trim() || "" : "";
    if (!operator || !Number.isFinite(openingAmount) || openingAmount < 0) return false;
    if ((state.cashSessions ?? []).some((session) => session.status === "open" && isCashSessionForOperator(session, operator))) return false;
    const session: CashSession = { id: crypto.randomUUID(), openedAt: new Date().toISOString(), openedBy: operator, operatorUsername: operator, openingAmount: Math.round(openingAmount * 100) / 100, status: "open", note: note.trim() || undefined };
    const queued = enqueueDomainCommand("cash", { action: "open", sessionId: session.id, openingAmount: session.openingAmount, note: session.note ?? "", idempotencyKey: crypto.randomUUID() });
    set({ cashSessions: [session, ...(state.cashSessions ?? [])] }, { persist: !queued });
    return session.id;
  },
  addCashMovement(type: "sangria" | "reforco", amount: number, reason: string) {
    const operator = typeof window !== "undefined" ? sessionStorage.getItem("mobflow-username")?.trim() || "" : "";
    const session = (state.cashSessions ?? []).find((item) => item.status === "open" && isCashSessionForOperator(item, operator));
    if (!session || !Number.isFinite(amount) || amount <= 0 || !reason.trim()) return false;
    const movement: CashMovement = { id: crypto.randomUUID(), sessionId: session.id, type, amount: Math.round(amount * 100) / 100, reason: reason.trim(), operator, date: new Date().toISOString() };
    const queued = enqueueDomainCommand("cash", { action: "movement", sessionId: session.id, amount: movement.amount, movementType: type === "reforco" ? "addition" : "withdrawal", reason: movement.reason, idempotencyKey: movement.id });
    set({ cashMovements: [movement, ...(state.cashMovements ?? [])] }, { persist: !queued });
    return movement.id;
  },
  closeCashSession(countedCash: number, note = "") {
    const operator = typeof window !== "undefined" ? sessionStorage.getItem("mobflow-username")?.trim() || "" : "";
    const session = (state.cashSessions ?? []).find((item) => item.status === "open" && isCashSessionForOperator(item, operator));
    if (!session || !Number.isFinite(countedCash) || countedCash < 0) return false;
    const sessionSales = (state.sales ?? []).filter((sale) => sale.cashSessionId === session.id);
    const cashSales = sessionSales.filter((sale) => sale.payment === "Dinheiro" && sale.paid !== false).reduce((sum, sale) => sum + sale.total, 0);
    const movements = (state.cashMovements ?? []).filter((item) => item.sessionId === session.id);
    const withdrawals = movements.filter((item) => item.type === "sangria").reduce((sum, item) => sum + item.amount, 0);
    const additions = movements.filter((item) => item.type === "reforco").reduce((sum, item) => sum + item.amount, 0);
    const expectedCash = Math.round((session.openingAmount + cashSales - withdrawals + additions) * 100) / 100;
    const counted = Math.round(countedCash * 100) / 100;
    const queued = enqueueDomainCommand("cash", { action: "close", sessionId: session.id, countedAmount: counted, note: note.trim(), idempotencyKey: crypto.randomUUID() });
    set({ cashSessions: (state.cashSessions ?? []).map((item) => item.id === session.id ? { ...item, status: "closed", closedAt: new Date().toISOString(), closedBy: operator, countedCash: counted, expectedCash, difference: Math.round((counted - expectedCash) * 100) / 100, note: [item.note, note.trim()].filter(Boolean).join(" · ") || undefined } : item) }, { persist: !queued });
    return { expectedCash, countedCash: counted, difference: Math.round((counted - expectedCash) * 100) / 100 };
  },
  async saveContact(contact: Omit<BusinessContact, "id"> & { id?: string }) {
    const id = contact.id || uid();
    const value: BusinessContact = { ...contact, id, name: contact.name.trim() };
    await savePrivateRecord("contact", id, value as unknown as Record<string, unknown>);
    const existing = (state.contacts ?? []).some((c) => c.id === id);
    set({ contacts: existing ? state.contacts.map((c) => c.id === id ? value : c) : [value, ...(state.contacts ?? [])] });
    return id;
  },
  async deleteContact(id: string) {
    await removePrivateContact(id);
    set({ contacts: (state.contacts ?? []).filter((c) => c.id !== id) });
  },
  addToCart(productId: string, qty = 1) {
    const p = state.products.find((x) => x.id === productId);
    if (!p) return;
    const cur = state.cart.find((c) => c.productId === productId);
    const nextQty = Math.max(0, (cur?.qty ?? 0) + qty);
    const cart = nextQty === 0
      ? state.cart.filter((c) => c.productId !== productId)
      : cur ? state.cart.map((c) => (c.productId === productId ? { ...c, qty: nextQty } : c)) : [...state.cart, { productId, qty: nextQty }];
    set({ cart });
  },
  setCartQty(productId: string, qty: number) {
    const p = state.products.find((x) => x.id === productId);
    if (!p || !Number.isFinite(qty)) return;
    const normalized = p.unit === "kg" ? Math.round(Math.max(0, qty) * 1000) / 1000 : Math.floor(Math.max(0, qty));
    const nextQty = normalized;
    const cart = nextQty <= 0
      ? state.cart.filter((c) => c.productId !== productId)
      : state.cart.map((c) => c.productId === productId ? { ...c, qty: nextQty } : c);
    set({ cart });
  },
  removeFromCart(productId: string) { set({ cart: state.cart.filter((c) => c.productId !== productId) }); },
  clearCart() { set({ cart: [] }); },
  checkout(payment: Payment, received?: number, customer?: string, cpf?: string, discount = 0, discountType: "R$" | "%" = "R$"): Sale | null {
    if (!state.cart.length) return null;
    // Regra de segurança: nenhuma venda pode ser registrada sem caixa aberto para o operador atual.
    const operator = typeof window !== "undefined" ? sessionStorage.getItem("mobflow-username")?.trim() || "" : "";
    const activeCash = (state.cashSessions ?? []).find((session) => session.status === "open" && isCashSessionForOperator(session, operator));
    if (!operator || !activeCash) return null;
    const items = state.cart.map((c) => {
      const p = state.products.find((x) => x.id === c.productId)!;
      return { productId: p.id, name: p.name, price: effectivePrice(p), cost: p.cost, qty: c.qty, unit: p.unit };
    });
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const discountValue = discountType === "%" ? subtotal * Math.min(100, Math.max(0, discount)) / 100 : Math.min(subtotal, Math.max(0, discount));
    const total = Math.max(0, subtotal - discountValue);
    const costTotal = items.reduce((sum, i) => sum + (i.cost ?? 0) * i.qty, 0);
    const profit = payment === "Fiado" ? 0 : total - costTotal;
    const seller = operator;
    const sale: Sale = { id: crypto.randomUUID(), date: new Date().toISOString() , cashSessionId: activeCash.id, items, total, profit, subtotal, discount: discountValue, discountType, payment, received, customer: customer || undefined, cpf: cpf || undefined, seller, paid: payment !== "Fiado", paidAt: payment === "Fiado" ? undefined : new Date().toISOString(), payments: payment === "Fiado" ? [] : undefined };
    const products = state.products.map((p) => {
      const c = state.cart.find((x) => x.productId === p.id);
      return c ? { ...p, stock: Math.round((p.stock - c.qty) * 1000) / 1000 } : p;
    });
    const stockMovements = state.cart.flatMap((c) => {
      const p = state.products.find((x) => x.id === c.productId);
      if (!p) return [];
      const stockAfter = Math.round((p.stock - c.qty) * 1000) / 1000;
      return [movementEntry({ id: `${sale.id}:${p.id}`, operationId: sale.id, date: sale.date, type: "Venda", productId: p.id, productCode: p.code, productName: p.name, unit: p.unit, quantity: c.qty, totalValue: Math.round(effectivePrice(p) * c.qty * 100) / 100, stockBefore: p.stock, stockAfter, delta: stockAfter - p.stock, details: `Venda ${sale.id}` })];
    });
    const queued = enqueueDomainCommand("sales", {
      saleId: sale.id, idempotencyKey: crypto.randomUUID(), cashSessionId: activeCash.id,
      paymentMethod: payment === "Dinheiro" ? "cash" : payment === "Pix" ? "pix" : payment === "Cartão" ? "card" : "fiado",
      receivedAmount: payment === "Fiado" ? 0 : payment === "Dinheiro" ? received ?? total : total,
      discountAmount: discount, discountType: discountType === "%" ? "percentage" : "fixed",
      customerName: customer || undefined, customerDocument: cpf || undefined,
      items: state.cart.map((item) => ({ productId: item.productId, quantity: item.qty })),
    });
    set({ products, cart: [], sales: [sale, ...state.sales], stockMovements: [...stockMovements, ...(state.stockMovements ?? [])] }, { persist: !queued });
    return sale;
  },
  async addFiadoPayment(id: string, value: number, method: "cash" | "pix" | "card" = "cash") {
    const sale = state.sales.find((s) => s.id === id && s.payment === "Fiado");
    if (!sale || sale.paid || !Number.isFinite(value) || value <= 0) return false;
    const amount = Math.min(Math.max(0, sale.total - (sale.payments ?? []).reduce((sum, p) => sum + p.value, 0)), Math.round(value * 100) / 100);
    if (amount <= 0) return false;
    const paidBefore = (sale.payments ?? []).reduce((sum, payment) => sum + payment.value, 0);
    const idempotencyKey = crypto.randomUUID();
    try {
      const result = await callMobFlowApi("/api/mobflow/receivables", {
        method: "POST",
        body: JSON.stringify({ saleId: id, amount, paymentMethod: method, idempotencyKey }),
      });
      if (!result.response.ok || result.body.ok !== true) {
        throw new Error(String(result.body.error ?? "O recebimento não foi confirmado pelo Neon."));
      }
      await hydrateStore();
      return true;
    } catch (error) {
      // If the connection drops after Neon commits, reconcile before allowing a retry.
      await hydrateStore().catch(() => undefined);
      const refreshed = state.sales.find((item) => item.id === id && item.payment === "Fiado");
      const paidAfter = (refreshed?.payments ?? []).reduce((sum, payment) => sum + payment.value, 0);
      if (paidAfter >= paidBefore + amount - 0.005) return true;
      throw error;
    }
  },
  hideFiadoCustomer(customer: string) {
    const normalized = customer.trim().toLocaleLowerCase();
    if (!normalized) return false;
    const matching = state.sales.filter((s) => s.payment === "Fiado" && (s.customer || "Cliente não informado").trim().toLocaleLowerCase() === normalized);
    if (!matching.length) return false;
    set({ sales: state.sales.map((s) => matching.some((item) => item.id === s.id) ? { ...s, hiddenFromFiado: true } : s) });
    return true;
  },
  async markFiadoPaid(id: string) {
    const sale = state.sales.find((s) => s.id === id && s.payment === "Fiado");
    if (!sale || sale.paid) return;
    await actions.addFiadoPayment(id, sale.total);
  },
  async updateSettings(settings: AppSettings) {
    await savePrivateRecord("settings", undefined, settings as unknown as Record<string, unknown>);
    set({ settings });
  },
  async loadPromotions() {
    const result = await callMobFlowApi("/api/mobflow/promotions");
    if (!result.response.ok || result.body.ok !== true) throw new Error(String(result.body.error ?? "Falha ao carregar promoções do Neon."));
    set({ promotions: Array.isArray(result.body.promotions) ? result.body.promotions as Promotion[] : [] });
    return Array.isArray(result.body.events) ? result.body.events as PromotionEvent[] : [];
  },
  async savePromotion(promotion: Omit<Promotion, "id" | "originalPrice" | "productName"> & { id?: string }) {
    const product = state.products.find((p) => p.id === promotion.productId);
    if (!product || !Number.isFinite(promotion.promoPrice) || promotion.promoPrice < 0 || !promotion.startsAt || !promotion.endsAt || new Date(promotion.endsAt) <= new Date(promotion.startsAt)) return false;
    const existing = promotion.id ? state.promotions.find((p) => p.id === promotion.id) : undefined;
    const method = promotion.id ? "PATCH" : "POST";
    const payload = { id: promotion.id, productId: promotion.productId, promoPrice: promotion.promoPrice, startsAt: promotion.startsAt, endsAt: promotion.endsAt, ...(existing ? { expectedVersion: existing.version ?? 1 } : {}) };
    const result = await callMobFlowApi("/api/mobflow/promotions", { method, body: JSON.stringify(payload) });
    if (!result.response.ok || result.body.ok !== true || !result.body.promotion) throw new Error(String(result.body.error ?? "Falha ao salvar promoção no Neon."));
    const item = result.body.promotion as Promotion;
    set({ promotions: item.id === existing?.id ? state.promotions.map((p) => p.id === item.id ? item : p) : [item, ...state.promotions] });
    return true;
  },
  async deletePromotion(id: string) {
    const existing = state.promotions.find((p) => p.id === id);
    if (!existing) throw new Error("Promoção não encontrada na lista atual.");
    const result = await callMobFlowApi("/api/mobflow/promotions", { method: "DELETE", body: JSON.stringify({ id, expectedVersion: existing.version ?? 1 }) });
    if (!result.response.ok || result.body.ok !== true) throw new Error(String(result.body.error ?? "Falha ao excluir promoção no Neon."));
    set({ promotions: state.promotions.filter((p) => p.id !== id) });
  },
  async resetAppData() {
    // Descarta também comandos offline antigos para que vendas/movimentos não reapareçam após a limpeza.
    if (cloudAccountId) {
      await persistQueue.catch(() => undefined);
      await syncOutbox.clearTenant(cloudAccountId);
      writeOutboxBackup(readOutboxBackup().filter((command) => command.tenantId !== cloudAccountId));
    }
    set({
      contacts: [],
      products: [],
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
      settings: { companyName: "" },
    });
  },
  applyCatalogProduct(product: Product) {
    const existing = state.products.some((item) => item.id === product.id);
    // The relational catalog API already committed this product and its sync event.
    // Do not race that transaction with a stale whole-app-state PUT.
    set({ products: existing
      ? state.products.map((item) => item.id === product.id ? { ...item, ...product } : item)
      : [product, ...state.products] }, { persist: false });
  },
  saveProduct(p: Omit<Product, "id"> & { id?: string | undefined }) {
    if (p.id && state.products.some((x) => x.id === p.id)) {
      const old = state.products.find((x) => x.id === p.id);
      const updated = { ...old, ...p, id: p.id } as Product;
      const movements = old && old.stock !== updated.stock ? [movementEntry({ operationId: `manual:${uid()}`, date: new Date().toISOString(), type: "Ajuste manual", productId: old.id, productCode: old.code, productName: old.name, unit: old.unit, quantity: Math.abs(updated.stock - old.stock), totalValue: Math.round(Math.abs(updated.stock - old.stock) * updated.price * 100) / 100, stockBefore: old.stock, stockAfter: updated.stock, delta: updated.stock - old.stock, details: "Alteração manual do cadastro" })] : [];
      set({ products: state.products.map((x) => (x.id === p.id ? updated : x)), stockMovements: [...movements, ...(state.stockMovements ?? [])] });
    } else if (p.id) {
      const product = { ...p, id: p.id } as Product;
      set({ products: [product, ...state.products] });
    } else {
      const id = uid();
      const product = { ...p, id } as Product;
      const movements = product.stock > 0 ? [movementEntry({ id: `cadastro:${id}`, operationId: id, date: new Date().toISOString(), type: "Cadastro", productId: id, productCode: product.code, productName: product.name, unit: product.unit, quantity: product.stock, totalValue: Math.round(product.stock * product.price * 100) / 100, stockBefore: 0, stockAfter: product.stock, delta: product.stock, details: "Estoque inicial do cadastro" })] : [];
      set({ products: [product, ...state.products], stockMovements: [...movements, ...(state.stockMovements ?? [])] });
    }
  },
  importProducts(rows: { code: string; name: string; qty: number; price?: number | undefined }[], mode: "replace" | "add") {
    const products = [...state.products];
    let created = 0, updated = 0;
    for (const r of rows) {
      const i = products.findIndex((p) => p.code === r.code);
      if (i >= 0) {
        const p = products[i]!;
        products[i] = { ...p, name: r.name || p.name, stock: mode === "add" ? p.stock + r.qty : r.qty, price: r.price ?? p.price };
        updated++;
      } else {
        products.unshift({ id: uid(), code: r.code, name: r.name || r.code, price: r.price ?? 0, stock: r.qty, minStock: 5, category: "Geral", unit: "un", ref: undefined, cost: undefined });
        created++;
      }
    }
    const stockMovements: StockMovement[] = [];
    for (const product of products) {
      const previous = state.products.find((p) => p.id === product.id);
      if (!previous) {
        if (product.stock > 0) stockMovements.push(movementEntry({ id: `import:${product.id}:${uid()}`, operationId: `import:${product.id}`, date: new Date().toISOString(), type: "Importação", productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: product.stock, totalValue: Math.round(product.stock * product.price * 100) / 100, stockBefore: 0, stockAfter: product.stock, delta: product.stock, details: "Produto incluído pela importação" }));
      } else if (previous.stock !== product.stock) {
        stockMovements.push(movementEntry({ operationId: `import:${uid()}`, date: new Date().toISOString(), type: "Importação", productId: product.id, productCode: product.code, productName: product.name, unit: product.unit, quantity: Math.abs(product.stock - previous.stock), totalValue: Math.round(Math.abs(product.stock - previous.stock) * product.price * 100) / 100, stockBefore: previous.stock, stockAfter: product.stock, delta: product.stock - previous.stock, details: `Importação em modo ${mode}` }));
      }
    }
    set({ products, stockMovements: [...stockMovements, ...(state.stockMovements ?? [])] });
    return { created, updated };
  },
  updateField(id: string, field: "price" | "stock", value: number) {
    const product = state.products.find((x) => x.id === id);
    if (!product) return;
    const movements = field === "stock" && product.stock !== value ? [movementEntry({ operationId: `field:${uid()}`, date: new Date().toISOString(), type: "Ajuste manual", productId: id, productCode: product.code, productName: product.name, unit: product.unit, quantity: Math.abs(value - product.stock), totalValue: Math.round(Math.abs(value - product.stock) * product.price * 100) / 100, stockBefore: product.stock, stockAfter: value, delta: value - product.stock, details: "Alteração direta do estoque" })] : [];
    set({ products: state.products.map((x) => (x.id === id ? { ...x, [field]: value } : x)), stockMovements: [...movements, ...(state.stockMovements ?? [])] });
  },
  applyStockAdjustmentBatch(input: { reason: string; items: { productId: string; mode: "somar" | "definir"; quantity: number }[] }) {
    const reason = input.reason.trim();
    if (!reason || !input.items.length) return false;
    const prepared = input.items.map((item) => {
      const product = state.products.find((p) => p.id === item.productId);
      if (!product || !Number.isFinite(item.quantity) || item.quantity < 0) return null;
      if (product.unit !== "kg" && !Number.isInteger(item.quantity)) return null;
      const quantity = product.unit === "kg" ? Math.round(item.quantity * 1000) / 1000 : item.quantity;
      const newStock = item.mode === "somar" ? product.stock + quantity : quantity;
      return {
        productId: product.id, code: product.code, ref: product.ref, name: product.name, unit: product.unit,
        mode: item.mode, quantity, previousStock: product.stock, newStock,
      };
    });
    if (prepared.some((item) => item === null)) return false;
    const items = prepared as StockAdjustment["items"];
    const id = uid();
    const adjustment: StockAdjustment = {
      id, date: new Date().toISOString(), reason,
      operator: typeof window !== "undefined" ? sessionStorage.getItem("mobflow-username")?.trim() || undefined : undefined,
      items,
    };
    const updatedProducts = state.products.map((product) => {
      const changed = items.find((item) => item.productId === product.id);
      return changed ? { ...product, stock: changed.newStock } : product;
    });
    const stockMovements = items.map((item) => movementEntry({ id: `${id}:${item.productId}`, operationId: id, date: adjustment.date, type: "Balanço", productId: item.productId, productCode: item.code, productName: item.name, unit: item.unit, quantity: Math.abs(item.newStock - item.previousStock), totalValue: Math.round(Math.abs(item.newStock - item.previousStock) * (state.products.find((p) => p.id === item.productId)?.price ?? 0) * 100) / 100, stockBefore: item.previousStock, stockAfter: item.newStock, delta: item.newStock - item.previousStock, details: reason }));
    const queued = enqueueDomainCommand("stock", {
      operationId: id, operationType: "adjustment", reason,
      items: items.map((item) => ({ productId: item.productId, mode: item.mode === "definir" ? "set" : "add", quantity: item.quantity })),
    });
    if (!queued || incrementalSyncEnabled()) {
      set({ products: updatedProducts, stockAdjustments: [adjustment, ...(state.stockAdjustments ?? [])], stockMovements: [...stockMovements, ...(state.stockMovements ?? [])] }, { persist: !queued });
    }
    // With incremental sync disabled, enqueueDomainCommand commits through Neon and
    // hydrateStore refreshes the authoritative state before confirmLastDomainCommand resolves.
    return id;
  },
  applyStockWriteoff(input: { reason: "Perda" | "Consumo" | "Doação"; donationDestination?: string | undefined; costMode: "compra" | "venda" | "media"; items: { productId: string; quantity: number }[] }) {
    const reason = input.reason;
    if (!input.items.length || (reason === "Doação" && !input.donationDestination?.trim())) return false;
    const prepared = input.items.map((item) => {
      const p = state.products.find((x) => x.id === item.productId);
      if (!p || !Number.isFinite(item.quantity) || item.quantity <= 0 || (p.unit !== "kg" && !Number.isInteger(item.quantity))) return null;
      const quantity = p.unit === "kg" ? Math.round(item.quantity * 1000) / 1000 : item.quantity;
      const purchase = Math.max(0, p.cost ?? 0);
      const sale = Math.max(0, p.price ?? 0);
      const unitCost = input.costMode === "compra" ? purchase : input.costMode === "venda" ? sale : (purchase + sale) / 2;
      return { productId: p.id, code: p.code, ref: p.ref, name: p.name, unit: p.unit, quantity, previousStock: p.stock, newStock: Math.round((p.stock - quantity) * 1000) / 1000, costMode: input.costMode, unitCost, totalCost: Math.round(unitCost * quantity * 100) / 100 };
    });
    if (prepared.some((x) => x === null)) return false;
    const items = prepared as StockWriteoff["items"];
    const existing = state.stockWriteoffs ?? [];
    const sequence = existing.length + 10;
    const now = new Date();
    const entry: StockWriteoff = {
      id: uid(), number: `NF: ${String(sequence).padStart(5, "0")}`,
      date: now.toISOString(), reason, donationDestination: reason === "Doação" ? input.donationDestination?.trim() : undefined,
      costMode: input.costMode,
      operator: typeof window !== "undefined" ? sessionStorage.getItem("mobflow-username")?.trim() || undefined : undefined,
      items,
    };
    const products = state.products.map((p) => {
      const item = items.find((x) => x.productId === p.id);
      return item ? { ...p, stock: item.newStock } : p;
    });
    const stockMovements = items.map((item) => movementEntry({ id: `${entry.id}:${item.productId}`, operationId: entry.id, date: entry.date, type: "Baixa", productId: item.productId, productCode: item.code, productName: item.name, unit: item.unit, quantity: item.quantity, totalValue: item.totalCost, stockBefore: item.previousStock, stockAfter: item.newStock, delta: item.newStock - item.previousStock, details: `${entry.number} · ${reason}` }));
    const queued = enqueueDomainCommand("stock", {
      operationId: entry.id, operationType: "writeoff", reason, costMode: input.costMode, donationDestination: entry.donationDestination,
      number: entry.number, items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    });
    if (!queued || incrementalSyncEnabled()) {
      set({ products, stockWriteoffs: [entry, ...existing], stockMovements: [...stockMovements, ...(state.stockMovements ?? [])] }, { persist: !queued });
    }
    // With incremental sync disabled, wait for the transactional Neon response and
    // the subsequent hydration before exposing the new stock balance locally.
    return entry;
  },
  async applyStockTransfer(input: { destinationName: string; destinationDocument?: string; destinationPhone?: string; destinationStreet?: string; destinationNumber?: string; destinationCep?: string; destinationNeighborhood?: string; destinationCity?: string; destinationState?: string; costMode: "compra" | "venda" | "media"; items: { productId: string; quantity: number }[] }) {
    if (!input.destinationName.trim() || !input.items.length) return false;
    const prepared = input.items.map((item) => {
      const p = state.products.find((x) => x.id === item.productId);
      if (!p || !Number.isFinite(item.quantity) || item.quantity <= 0 || (p.unit !== "kg" && !Number.isInteger(item.quantity))) return null;
      const quantity = p.unit === "kg" ? Math.round(item.quantity * 1000) / 1000 : item.quantity;
      const purchase = Math.max(0, p.cost ?? 0), sale = Math.max(0, p.price ?? 0);
      const unitCost = input.costMode === "compra" ? purchase : input.costMode === "venda" ? sale : (purchase + sale) / 2;
      return { productId: p.id, code: p.code, ref: p.ref, name: p.name, unit: p.unit, quantity, previousStock: p.stock, newStock: Math.round((p.stock - quantity) * 1000) / 1000, costMode: input.costMode, unitCost, totalCost: Math.round(unitCost * quantity * 100) / 100 };
    });
    if (prepared.some((item) => item === null)) return false;
    const items = prepared as StockWriteoffItem[];
    const sequence = (state.stockTransfers ?? []).length + 10;
    const entry: StockTransfer = {
      id: uid(), number: "NF:" + String(sequence).padStart(4, "0"), date: new Date().toISOString(),
      reason: "Transferência de produtos, Vendas", destinationName: input.destinationName.trim(),
      destinationDocument: input.destinationDocument?.trim() || undefined, destinationPhone: input.destinationPhone?.trim() || undefined,
      destinationStreet: input.destinationStreet?.trim() || undefined, destinationNumber: input.destinationNumber?.trim() || undefined,
      destinationCep: input.destinationCep?.trim() || undefined, destinationNeighborhood: input.destinationNeighborhood?.trim() || undefined,
      destinationCity: input.destinationCity?.trim() || undefined, destinationState: input.destinationState?.trim() || undefined,
      costMode: input.costMode, operator: currentOperator(), items,
    };
    try {
      const result = await callMobFlowApi("/api/mobflow/stock", {
        method: "POST",
        body: JSON.stringify({
          operationId: entry.id, idempotencyKey: crypto.randomUUID(), operationType: "transfer",
          reason: entry.reason, number: entry.number, costMode: input.costMode, destinationName: entry.destinationName,
          destinationDocument: entry.destinationDocument, destinationPhone: entry.destinationPhone,
          destinationStreet: entry.destinationStreet, destinationNumber: entry.destinationNumber, destinationCep: entry.destinationCep,
          destinationNeighborhood: entry.destinationNeighborhood, destinationCity: entry.destinationCity, destinationState: entry.destinationState,
          items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        }),
      });
      if (!result.response.ok || result.body.ok !== true) { console.error("[MobFlow Transfer]", result.body.error ?? result.response.status); return false; }
      await hydrateStore();
      return entry;
      } catch (error) {
      // The server may commit and the response may be lost. Reload the relational
      // snapshot before telling the operator to retry, otherwise stock could be deducted twice.
      await hydrateStore().catch(() => undefined);
      if ((state.stockTransfers ?? []).some((item) => item.id === entry.id)) return entry;
      console.error("[MobFlow Transfer]", error);
      return false;
    }
  },
  attachStockTransferDocument(id: string, document: unknown) { if (!(state.stockTransfers ?? []).some((item) => item.id === id)) return false; set({ stockTransfers: (state.stockTransfers ?? []).map((item) => item.id === id ? { ...item, document } : item) }); return true; },
  attachStockWriteoffDocument(id: string, document: unknown) {
    if (!(state.stockWriteoffs ?? []).some((item) => item.id === id)) return false;
    set({ stockWriteoffs: (state.stockWriteoffs ?? []).map((item) => item.id === id ? { ...item, document } : item) });
    return true;
  },
  deleteProduct(id: string) {
    const neonCatalog = import.meta.env["VITE_MOBFLOW_CATALOG_READ_PROVIDER"] === "neon";
    // In Neon mode the archive/delete event was already committed by DELETE /products.
    // Avoid a second, stale app_state write that can produce a harmless CAS 409.
    set(
      { products: state.products.filter((x) => x.id !== id), cart: state.cart.filter((c) => c.productId !== id) },
      { persist: !neonCatalog },
    );
  },
  newConference(name: string): string {
    const c: Conference = { id: uid(), name: name || `Conferência ${new Date().toLocaleDateString("pt-BR")}`, date: new Date().toISOString(), status: "aberta", counts: {}, unknown: [] };
    set({ conferences: [c, ...(state.conferences ?? [])] });
    return c.id;
  },
  patchConference(id: string, fn: (c: Conference) => Conference) {
    set({ conferences: state.conferences.map((c) => (c.id === id ? fn(c) : c)) });
  },
  countCode(confId: string, code: string, qty = 1): Product | null {
    const p = state.products.find((x) => productHasBarcode(x, code));
    actions.patchConference(confId, (c) => p
      ? { ...c, counts: { ...c.counts, [p.id]: Math.max(0, (c.counts[p.id] ?? 0) + qty) } }
      : { ...c, unknown: c.unknown.includes(code) ? c.unknown : [...c.unknown, code] });
    return p ?? null;
  },
  setCount(confId: string, productId: string, n: number) {
    actions.patchConference(confId, (c) => ({ ...c, counts: { ...c.counts, [productId]: Math.max(0, n) } }));
  },
  setExpiry(confId: string, productId: string, expiry: string) {
    actions.patchConference(confId, (c) => ({ ...c, expiries: { ...(c.expiries ?? {}), [productId]: expiry } }));
  },
  finishConference(id: string, adjust: boolean) {
    const conf = state.conferences.find((c) => c.id === id);
    if (!conf) return;
    const products = adjust ? state.products.map((p) => (p.id in conf.counts ? { ...p, stock: conf.counts[p.id]! } : p)) : state.products;
    const stockMovements = adjust ? state.products.filter((p) => p.id in conf.counts && p.stock !== conf.counts[p.id]!).map((p) => movementEntry({ id: `${id}:${p.id}`, operationId: id, date: new Date().toISOString(), type: "Balanço", productId: p.id, productCode: p.code, productName: p.name, unit: p.unit, quantity: Math.abs(conf.counts[p.id]! - p.stock), totalValue: Math.round(Math.abs(conf.counts[p.id]! - p.stock) * p.price * 100) / 100, stockBefore: p.stock, stockAfter: conf.counts[p.id]!, delta: conf.counts[p.id]! - p.stock, details: conf.name })) : [];
    set({ products, conferences: state.conferences.map((c) => (c.id === id ? { ...c, status: "finalizada", adjusted: adjust } : c)), stockMovements: [...stockMovements, ...(state.stockMovements ?? [])] });
  },
  addManualExpiry(productId: string, expiry: string, quantity: number) {
    const product = state.products.find((p) => p.id === productId);
    if (!product || !expiry || !Number.isFinite(quantity) || quantity <= 0) return false;
    const [year, month, day] = expiry.split("-").map(Number);
    const formattedExpiry = year && month && day
      ? `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`
      : expiry;
    const allocated = (state.manualExpiries ?? []).filter((e) => e.productId === productId).reduce((sum, e) => sum + e.quantity, 0);
    if (quantity > product.stock - allocated) return false;
    const entry: ManualExpiry = { id: uid(), productId: product.id, name: product.name, quantity, expiry: formattedExpiry, unit: product.unit };
    set({ manualExpiries: [entry, ...(state.manualExpiries ?? [])] });
    return true;
  },
  updateManualExpiry(noteId: string, productId: string, expiry: string, quantity: number) {
    const product = state.products.find((p) => p.id === productId);
    const existing = (state.manualExpiries ?? []).find((e) => e.id === noteId);
    if (!product || !existing || !expiry || !Number.isFinite(quantity) || quantity <= 0) return false;
    const [year, month, day] = expiry.split("-").map(Number);
    const formattedExpiry = year && month && day
      ? `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`
      : expiry;
    const allocatedElsewhere = (state.manualExpiries ?? []).filter((e) => e.productId === productId && e.id !== noteId).reduce((sum, e) => sum + e.quantity, 0);
    if (quantity > product.stock - allocatedElsewhere) return false;
    set({ manualExpiries: (state.manualExpiries ?? []).map((e) => e.id === noteId ? { ...e, productId: product.id, name: product.name, quantity, expiry: formattedExpiry, unit: product.unit } : e) });
    return true;
  },
  deleteManualExpiry(noteId: string) {
    if (!(state.manualExpiries ?? []).some((e) => e.id === noteId)) return false;
    set({ manualExpiries: (state.manualExpiries ?? []).filter((e) => e.id !== noteId) });
    return true;
  },
  async createReceiving(number: string, supplier: string, supplierCnpj: string | undefined, items: { productId: string; expected: number }[]) {
    const receiving: ReceivingNote = {
      id: uid(), number: number.trim() || "Sem número", supplier: supplier.trim() || "Fornecedor não informado", supplierCnpj: supplierCnpj?.trim() || undefined,
      date: new Date().toISOString(),
      items: items.map((i) => {
        const p = state.products.find((x) => x.id === i.productId)!;
        return { productId: p.id, name: p.name, expected: Math.max(0, i.expected), unit: p.unit };
      }),
      status: "pendente",
    };
    set({ receiving: [receiving, ...(state.receiving ?? [])], suppliers: supplier.trim() ? (() => { const name = supplier.trim(); const cnpj = supplierCnpj?.trim() || undefined; const existing = (state.suppliers ?? []).find(s => s.name.toLowerCase() === name.toLowerCase()); return existing ? (state.suppliers ?? []).map(s => s.name.toLowerCase() === name.toLowerCase() ? { ...s, name, cnpj: cnpj || s.cnpj } : s) : [{ name, cnpj }, ...(state.suppliers ?? [])]; })() : (state.suppliers ?? []) });
    await persistReceivingRecord(receiving);
    return receiving.id;
  },
  async updateReceiving(id: string, patch: Partial<Pick<ReceivingNote, "number" | "supplier">>) {
    const updated = (state.receiving ?? []).map((n) => n.id === id ? { ...n, ...patch } : n); set({ receiving: updated });
    const note = updated.find((n) => n.id === id); if (note) await persistReceivingRecord(note);
  },
  async addReceivingItems(id: string, items: { productId: string; expected: number }[]) {
    const note = (state.receiving ?? []).find((n) => n.id === id);
    if (!note || note.status !== "pendente") return;
    const additions = items
      .map((item) => {
        const p = state.products.find((x) => x.id === item.productId);
        const expected = Number(item.expected);
        return p && Number.isFinite(expected) && expected > 0
          ? { productId: p.id, name: p.name, expected, unit: p.unit as "un" | "kg" }
          : null;
      })
      .filter(Boolean) as ReceivingItem[];
    if (!additions.length) return;
    const merged = [...note.items];
    for (const item of additions) {
      const existing = merged.find((i) => i.productId === item.productId);
      if (existing) existing.expected += item.expected;
      else merged.push(item);
    }
    const updated = (state.receiving ?? []).map((n) => n.id === id ? { ...n, items: merged } : n); set({ receiving: updated });
    const saved = updated.find((n) => n.id === id); if (saved) await persistReceivingRecord(saved);
  },
  startReceivingConference(receivingId: string) {
    const n = (state.receiving ?? []).find((x) => x.id === receivingId);
    if (!n || n.status !== "pendente") return null;
    const existing = state.conferences.find((c) => c.receivingId === receivingId && c.status === "aberta");
    if (existing) return existing.id;
    const c: Conference = {
      id: uid(), name: `Nota ${n.number} · ${n.supplier}`, date: new Date().toISOString(),
      status: "aberta", counts: {}, unknown: [], extraCounts: {}, extraExpiries: {}, receivingId,
    };
    set({ conferences: [c, ...(state.conferences ?? [])] });
    void persistReceivingConference(c).catch((error)=>console.error("[MobFlow Receiving]",error));
    return c.id;
  },
  saveReceivingConferenceDraft(receivingId: string, counts: Record<string, number>, expiries: Record<string, string>, extraCounts: Record<string, number>, extraExpiries: Record<string, string>) {
    const note = (state.receiving ?? []).find((n) => n.id === receivingId);
    if (!note || note.status !== "pendente") return;
    let conference = state.conferences.find((c) => c.receivingId === receivingId && c.status === "aberta");
    if (!conference) {
      conference = {
        id: uid(), name: `Nota ${note.number} · ${note.supplier}`, date: new Date().toISOString(),
        status: "aberta", counts: {}, unknown: [], extraCounts: {}, extraExpiries: {}, receivingId,
      };
      set({ conferences: [conference, ...(state.conferences ?? [])] });
    }
    const updatedConference = { ...conference, counts: { ...counts }, expiries: { ...expiries }, extraCounts: { ...extraCounts }, extraExpiries: { ...extraExpiries } };
    set({ conferences: state.conferences.map((c) => c.id === conference!.id ? updatedConference : c) });
    if (receivingDraftPersistTimer) clearTimeout(receivingDraftPersistTimer);
    receivingDraftPersistTimer = setTimeout(() => { void persistReceivingConference(updatedConference).catch((error)=>console.error("[MobFlow Receiving draft]",error)); }, 500);
  },
  async saveReceivingConference(receivingId: string, counts: Record<string, number>, expiries: Record<string, string>, extraCounts: Record<string, number>, extraExpiries: Record<string, string>) {
    if (receivingDraftPersistTimer) clearTimeout(receivingDraftPersistTimer);
    receivingDraftPersistTimer = null;
    const note = (state.receiving ?? []).find((n) => n.id === receivingId);
    if (!note || note.status !== "pendente") return false;
    const extras = Object.entries(extraCounts).filter(([, received]) => received > 0).map(([productId, received]) => {
      const p = state.products.find((x) => x.id === productId);
      return p ? { productId, name: p.name, received, expiry: extraExpiries[productId] || undefined, unit: p.unit } : null;
    }).filter(Boolean) as ReceivingExtra[];
    const conference: Conference = {
      id: uid(), name: `Nota ${note.number} · ${note.supplier}`, date: new Date().toISOString(),
      status: "finalizada", counts: { ...counts }, unknown: [], receivingId,
      expiries: { ...expiries }, extraCounts: { ...extraCounts }, extraExpiries: { ...extraExpiries },
    };
    const divergent = extras.length > 0 || note.items.some((i) => (counts[i.productId] ?? 0) !== i.expected);
    const updatedReceiving = (state.receiving ?? []).map((n) => n.id === note.id ? {
      ...n,
      items: n.items.map((i) => ({ ...i, received: counts[i.productId] ?? 0, expiry: expiries[i.productId] || undefined })),
      extras, status: "analisando" as const, decisions: {}, decisionCompleted: false, stockReleased: false,
    } : n);
    set({
      receiving: updatedReceiving,
      conferences: [conference, ...(state.conferences ?? []).filter((item) => item.receivingId !== receivingId || item.status !== "aberta")],
    });
    const saved = updatedReceiving.find((n) => n.id === note.id); if (saved) await persistReceivingRecord(saved);
    await persistReceivingConference(conference);
    return true;
  },
  async acceptReceiving(id: string) {
    const note = (state.receiving ?? []).find((n) => n.id === id);
    if (!note || (note.status !== "analisando" && note.status !== "divergente" && note.status !== "conferido") || note.stockReleased || !note.decisionCompleted) return false;
    const result = await callMobFlowApi("/api/mobflow/receiving", {
      method: "POST",
      body: JSON.stringify({ action: "accept", receivingId: id }),
    });
    const data = result.body.data;
    const error = result.response.ok ? null : result.body.error;
    if (error || data !== true) {
      await hydrateStore();
      return false;
    }
    // The RPC is the authoritative stock update in the database. Do not add
    // the received quantities again in client state; reload the committed state
    // so Realtime and local state cannot apply the same receipt twice.
    await hydrateStore();
    return true;
  },
  async finishReceivingAction(id: string) {
    const note = (state.receiving ?? []).find((n) => n.id === id);
    if (!note || !note.stockReleased || !Object.values(note.decisions ?? {}).includes("devolver")) return false;
    const updated = (state.receiving ?? []).map((n) => n.id === id ? { ...n, actionCompleted: true } : n);
    set({ receiving: updated });
    const saved = updated.find((n) => n.id === id); if (saved) void persistReceivingRecord(saved).catch((error)=>console.error("[MobFlow Receiving]",error));
    return true;
  },
  async setReceivingDecision(id: string, productKey: string, decision: "aceitar" | "devolver") {
    const updated = (state.receiving ?? []).map((n) => n.id === id ? { ...n, decisions: { ...(n.decisions ?? {}), [productKey]: decision }, decisionCompleted: false } : n); set({ receiving: updated });
    const note = updated.find((n) => n.id === id); if (note) await persistReceivingRecord(note);
  },
  async completeReceivingDecision(id: string) {
    const note = (state.receiving ?? []).find((n) => n.id === id);
    if (!note || note.status !== "analisando" || note.stockReleased) return false;
    const keys = [...note.items.map(i => i.productId), ...(note.extras ?? []).map(i => i.productId)];
    const decisions = note.decisions ?? {};
    if (!keys.length || keys.some(key => !["aceitar", "devolver"].includes(decisions[key] ?? ""))) return false;

    // Send the current decisions directly. The database validates them and
    // releases accepted quantities in one transaction, avoiding a race where
    // decisionCompleted is not yet persisted when the RPC runs.
    // Make sure the latest conference quantities/status have reached the cloud
    // before the database validates and releases stock.
    await persistQueue;
    const rpcResult = await Promise.race([
      (async () => {
        const result = await callMobFlowApi("/api/mobflow/receiving", {
          method: "POST",
          body: JSON.stringify({ action: "finalize_decisions", receivingId: id, decisions }),
        });
        return {
          data: result.body.data,
          error: result.response.ok ? null : { message: String(result.body.error || "Falha ao finalizar o recebimento.") },
        };
      })(),
      new Promise<{ data: null; error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: { message: "Tempo limite ao atualizar o estoque." } }), 20000)
      ),
    ]);

    if (rpcResult.error || rpcResult.data !== true) {
      // Keep the local conference and decisions on screen. Hydrating here can
      // replace a just-finished local conference with an older cloud snapshot,
      // forcing the user to count the delivery again.
      return false;
    }

    // Do not call set() here: it persists the whole local state and could
    // overwrite the stock just committed by the RPC with an older snapshot.
    state = {
      ...state,
      receiving: (state.receiving ?? []).map((n) => n.id === id
        ? { ...n, decisions, decisionCompleted: true, status: "aceito", stockReleased: true }
        : n),
    };
    try { localStorage.setItem(activeStateKey, JSON.stringify(state)); } catch {}
    listeners.forEach((l) => l());
    void hydrateStore();
    return true;
  },
  async rejectReceiving(id: string) {
    const updated = (state.receiving ?? []).map((n) => n.id === id ? { ...n, status: "rejeitado" as const, stockReleased: false } : n); set({ receiving: updated });
    const note = updated.find((n) => n.id === id); if (note) void persistReceivingRecord(note).catch((error)=>console.error("[MobFlow Receiving]",error));
  },
  async deleteReceiving(id: string) {
    await deleteReceivingRecord(id);
    set({ receiving: (state.receiving ?? []).filter((n) => n.id !== id), conferences: state.conferences.filter((c) => c.receivingId !== id) });
  },
};

export const normalizeDocument = (v: string) => String(v ?? "").replace(/\D/g, "");
export const formatCpfCnpj = (v: string) => {
  const d = normalizeDocument(v).slice(0, 14);
  if (d.length <= 11) return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
};

export const formatCpf = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};

export function printFiadoBalance(customer: string, sales: Sale[]) {
  const accountSales = sales.filter((s) => s.payment === "Fiado" && (s.customer || "").trim() === customer.trim()).map((sale) => {
    const paid = (sale.payments ?? (sale.paid ? [{ value: sale.total, date: sale.paidAt ?? sale.date }] : [])).reduce((sum, p) => sum + p.value, 0);
    return { sale, paid: Math.min(sale.total, paid), remaining: Math.max(0, sale.total - paid) };
  }).sort((a, b) => +new Date(a.sale.date) - +new Date(b.sale.date));
  const total = accountSales.reduce((sum, x) => sum + x.sale.total, 0);
  const totalPaid = accountSales.reduce((sum, x) => sum + x.paid, 0);
  const totalRemaining = accountSales.reduce((sum, x) => sum + x.remaining, 0);
  const latestSale = accountSales[accountSales.length - 1]?.sale;
  const customerName = latestSale?.customer || customer;
  const customerCpf = accountSales.find((x) => x.sale.cpf)?.sale.cpf;
  const seller = latestSale?.seller;
  const rows = accountSales.map(({ sale: s }) => `<tr><td colspan="2" style="padding-top:8px;font-weight:bold">${new Date(s.date).toLocaleDateString("pt-BR")} às ${new Date(s.date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td></tr>${s.items.map((i) => `<tr><td>${i.qty}× ${i.name}</td><td style="text-align:right;white-space:nowrap">R$ ${brl(i.price * i.qty)}</td></tr>`).join("")}<tr><td colspan="2" style="padding-bottom:4px"><hr/></td></tr>`).join("");
  const w = window.open("", "_blank", "width=380,height=640");
  if (!w) return;
  w.document.write(`<html><head><title>Conta fiado - ${customerName}</title><style>body{font-family:monospace;font-size:12px;width:280px;margin:12px auto}h1{text-align:center;font-size:18px;margin:0}hr{border:0;border-top:1px dashed #000}table{width:100%;border-collapse:collapse}td{padding:4px 0;vertical-align:top}td:last-child{padding-left:8px}.c{text-align:center}p{margin:4px 0}.sum td{font-weight:bold;padding-top:6px}</style></head><body>
<h1>CONTA FIADO</h1><p class="c">Cliente: ${customerName}</p>${customerCpf ? `<p class="c">CPF: ${customerCpf}</p>` : ""}${seller ? `<p class="c">Vendedor: ${seller}</p>` : ""}<hr/>
<table>${rows}</table><hr/>
<table><tr><td>Total comprado</td><td style="text-align:right">R$ ${brl(total)}</td></tr><tr><td>Já pago</td><td style="text-align:right">R$ ${brl(totalPaid)}</td></tr><tr class="sum"><td>SALDO EM ABERTO</td><td style="text-align:right">R$ ${brl(totalRemaining)}</td></tr></table>
<hr/><p class="c">Comprovante de saldo — não é documento fiscal</p><script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

export function printReceipt(s: Sale, companyName = "") {
  const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
  let receiptCompanyName = companyName.trim() || state.settings?.companyName?.trim() || "";
  if (!receiptCompanyName && typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(activeStateKey);
      if (raw) receiptCompanyName = JSON.parse(raw)?.settings?.companyName?.trim() || "";
    } catch {}
  }
  const w = window.open("", "_blank", "width=420,height=720");
  if (!w) return;
  const rows = s.items.map((item) => {
    const product = state.products.find((entry) => entry.id === item.productId);
    const barcode = product?.barcodes?.[0] || product?.code || "";
    const productCode = barcode.replace(/\D/g, "").slice(-5) || "—";
    const quantity = item.qty.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
    const unit = item.unit === "kg" ? "kg" : "un";
    return `<tr>
      <td class="code">${escapeHtml(productCode)}</td>
      <td class="description">${escapeHtml(item.name)}</td>
      <td class="number">${quantity} ${unit}</td>
      <td class="number">R$ ${brl(item.price)}</td>
      <td class="number total">R$ ${brl(item.price * item.qty)}</td>
    </tr>`;
  }).join("");
  const subtotal = s.subtotal ?? s.total + (s.discount ?? 0);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Comprovante ${escapeHtml(s.id)}</title>
<style>
  @page{size:80mm auto;margin:3mm}
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.35;width:100%;max-width:74mm;margin:0 auto;color:#000;background:#fff}
  h1{text-align:center;font-size:16px;line-height:1.2;margin:0 0 3px;font-weight:700;overflow-wrap:anywhere}
  .subtitle{text-align:center;font-size:10px;letter-spacing:.5px;margin:0 0 8px}
  .meta{margin:5px 0}
  .meta p{margin:2px 0;overflow-wrap:anywhere}
  .rule{border:0;border-top:1px dashed #000;margin:7px 0}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  th{font-size:8px;text-align:left;font-weight:700;padding:4px 1px;border-top:1px solid #000;border-bottom:1px solid #000;vertical-align:bottom}
  td{font-size:8px;padding:5px 1px;border-bottom:1px dotted #777;vertical-align:top;overflow-wrap:anywhere}
  .code{width:15%;text-align:left}
  .description{width:29%;text-align:left}
  .number{text-align:right;width:18%;white-space:normal}
  .total{font-weight:700;width:20%}
  .summary{margin-top:6px}
  .summary td{border:0;padding:2px 1px;font-size:9px}
  .summary .grand-total td{font-size:12px;font-weight:700;border-top:1px solid #000;border-bottom:1px double #000;padding:5px 1px}
  .center{text-align:center}
  .footer{text-align:center;margin:10px 0 2px;font-size:10px}
  @media screen{body{padding:8px}}
</style></head><body>
<h1>${escapeHtml(receiptCompanyName || "COMPROVANTE DE COMPRA")}</h1>
<p class="subtitle">COMPROVANTE DE COMPRA</p>
<hr class="rule">
<div class="meta">
  <p>Data: ${escapeHtml(new Date(s.date).toLocaleString("pt-BR"))}</p>
  <p>Nº: ${escapeHtml(s.id.toUpperCase())}</p>
  ${s.customer ? `<p>Cliente: ${escapeHtml(s.customer)}</p>` : ""}
  ${s.cpf ? `<p>CPF: ${escapeHtml(s.cpf)}</p>` : ""}
  ${s.seller ? `<p>Vendedor: ${escapeHtml(s.seller)}</p>` : ""}
</div>
<table aria-label="Itens da compra">
  <thead><tr><th class="code">Código</th><th class="description">Descrição</th><th class="number">Qtd.</th><th class="number">V. un.</th><th class="number total">Total</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<table class="summary">
  ${s.discount ? `<tr><td>Subtotal</td><td style="text-align:right">R$ ${brl(subtotal)}</td></tr><tr><td>Desconto</td><td style="text-align:right">- R$ ${brl(s.discount)}</td></tr>` : ""}
  <tr class="grand-total"><td>TOTAL</td><td style="text-align:right">R$ ${brl(s.total)}</td></tr>
  <tr><td>Pagamento</td><td style="text-align:right">${escapeHtml(s.payment)}</td></tr>
  ${s.received && s.received > s.total ? `<tr><td>Recebido</td><td style="text-align:right">R$ ${brl(s.received)}</td></tr><tr><td>Troco</td><td style="text-align:right">R$ ${brl(s.received - s.total)}</td></tr>` : ""}
</table>
<hr class="rule">
<p class="footer">Obrigado pela preferência!</p>
<script>window.onload=()=>window.print();</script>
</body></html>`);
  w.document.close();
}

export function buildPixPayload(key: string, amount: number, merchantName = "MOBFLOW", city = "SAO PAULO") {
  const clean = (value: string, max: number) => value.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^A-Za-z0-9 ]/g, "").trim().slice(0, max).toUpperCase();
  const field = (id: string, value: string) => id + String(value.length).padStart(2, "0") + value;
  const payloadWithoutCrc =
    field("00", "01") +
    field("26", field("00", "BR.GOV.BCB.PIX") + field("01", key.trim().slice(0, 99))) +
    field("52", "0000") +
    field("53", "986") +
    field("54", Math.max(0, amount).toFixed(2)) +
    field("58", "BR") +
    field("59", clean(merchantName, 25) || "MOBFLOW") +
    field("60", clean(city, 15) || "SAO PAULO") +
    field("62", field("05", "***")) +
    "6304";
  let crc = 0xffff;
  for (let i = 0; i < payloadWithoutCrc.length; i++) {
    crc ^= payloadWithoutCrc.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return payloadWithoutCrc + crc.toString(16).toUpperCase().padStart(4, "0");
}

export const brl = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const productHasBarcode = (product: Pick<Product, "code" | "barcodes">, code: string) => {
  const value = code.trim();
  return !!value && (product.code.trim() === value || (product.barcodes ?? []).some((barcode) => barcode.trim() === value));
};