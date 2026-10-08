import { useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";

export type Product = { id: string; code: string; ref?: string | undefined; name: string; price: number; cost?: number | undefined; stock: number; minStock: number; category: string; unit: "un" | "kg"; photo?: string | undefined };
export type CartItem = { productId: string; qty: number };
export type Payment = "Dinheiro" | "Cartão" | "Pix" | "Fiado";
export type AppSettings = { companyName: string; companyLogo?: string | undefined; pixKey?: string | undefined; pixKeyType?: "telefone" | "cpf" | "cnpj" | "email" | "aleatoria" | undefined };
export type FiadoPayment = { value: number; date: string };
export type Sale = { id: string; date: string; items: { name: string; price: number; cost?: number | undefined; qty: number; unit?: "un" | "kg" | undefined }[]; total: number; profit?: number; subtotal?: number; discount?: number; discountType?: "R$" | "%"; payment: Payment; received?: number | undefined; customer?: string | undefined; cpf?: string | undefined; paid?: boolean; paidAt?: string | undefined; payments?: FiadoPayment[] | undefined };
export type ReceivingItem = { productId: string; name: string; expected: number; received?: number; unit: "un" | "kg" };
export type Supplier = { name: string; cnpj?: string | undefined };
export type ReceivingNote = {
  id: string;
  number: string;
  supplier: string;
  supplierCnpj?: string | undefined;
  date: string;
  items: ReceivingItem[];
  status: "pendente" | "conferido" | "divergente" | "aceito" | "rejeitado";
  stockReleased?: boolean;
};
export type Conference = {
  id: string;
  name: string;
  date: string;
  status: "aberta" | "finalizada";
  counts: Record<string, number>;
  unknown: string[];
  adjusted?: boolean;
  receivingId?: string;
};

type State = { products: Product[]; cart: CartItem[]; sales: Sale[]; conferences: Conference[]; receiving: ReceivingNote[]; suppliers: Supplier[]; settings: AppSettings };

const KEY = "mobflow:v1";
const OWNER_KEY = "mobflow:owner";
const uid = () => Math.random().toString(36).slice(2, 10);

const seed: Product[] = [
  ["7891000100", "Café Torrado 500g", 18.9, 24, "Mercearia"],
  ["7891000200", "Arroz Branco 5kg", 27.9, 12, "Mercearia"],
  ["7891000300", "Óleo de Soja 900ml", 9.5, 2, "Mercearia"],
  ["7891000400", "Açúcar Cristal 1kg", 6.2, 30, "Mercearia"],
  ["7891000500", "Feijão Carioca 1kg", 8.9, 1, "Mercearia"],
  ["7891000600", "Detergente Neutro", 3.4, 60, "Limpeza"],
  ["7891000700", "Leite Integral 1L", 6.8, 42, "Laticínios"],
  ["7891000800", "Refrigerante 2L", 8.9, 30, "Bebidas"],
  ["7891000900", "Água Mineral 1,5L", 4.5, 120, "Bebidas"],
].map(([code, name, price, stock, category]) => ({
  id: uid(), code: code as string, name: name as string, price: price as number, stock: stock as number, minStock: 5, category: category as string, unit: "un", ref: undefined, cost: undefined,
}));

let state: State = { products: seed, cart: [], sales: [], conferences: [], receiving: [], suppliers: [], settings: { companyName: "" } };
let loaded = false;
let cloudReady = false;
let hydrating: Promise<void> | null = null;
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let realtimeOwnerId: string | null = null;
let cloudAccountId: string | null = null;
let lastCloudUpdatedAt: string | null = null;
let lastSyncedState: State | null = null;
let persistQueue = Promise.resolve();
const listeners = new Set<() => void>();

const cloneState = (value: State): State => JSON.parse(JSON.stringify(value));

function mergeConcurrentState(base: State | null, local: State, remote: State): State {
  if (!base) return { ...remote, ...local, products: local.products, sales: remote.sales, conferences: remote.conferences, receiving: remote.receiving, suppliers: remote.suppliers };
  const mergeById = <T extends { id: string }>(left: T[], right: T[]) => {
    const map = new Map(right.map((x) => [x.id, x]));
    for (const item of left) if (!map.has(item.id)) map.set(item.id, item);
    return Array.from(map.values());
  };
  const products = remote.products.map((rp) => {
    const bp = base.products.find((p) => p.id === rp.id);
    const lp = local.products.find((p) => p.id === rp.id);
    if (!lp || !bp) return rp;
    const localStockChanged = lp.stock !== bp.stock;
    const remoteStockChanged = rp.stock !== bp.stock;
    if (localStockChanged && remoteStockChanged) {
      return { ...rp, stock: Math.max(0, bp.stock + (lp.stock - bp.stock) + (rp.stock - bp.stock)) };
    }
    if (localStockChanged && !remoteStockChanged) return lp;
    return rp;
  });
  for (const lp of local.products) if (!remote.products.some((p) => p.id === lp.id)) products.push(lp);
  return {
    ...remote,
    products,
    sales: mergeById(local.sales, remote.sales),
    conferences: mergeById(local.conferences, remote.conferences),
    receiving: mergeById(local.receiving, remote.receiving),
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
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...state, ...JSON.parse(raw) };
    state.products = state.products.map((p) => ({ ...p, unit: p.unit === "kg" ? "kg" : "un" }));
    normalizeState();
  } catch {}
}
function normalizeState() {
  state.products = Array.isArray(state.products) ? state.products : [];
  state.cart = Array.isArray(state.cart) ? state.cart : [];
  state.sales = Array.isArray(state.sales) ? state.sales : [];
  state.conferences = Array.isArray(state.conferences) ? state.conferences : [];
  state.receiving = Array.isArray(state.receiving) ? state.receiving : [];
  state.suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
  state.settings = state.settings && typeof state.settings === "object"
    ? state.settings
    : { companyName: "" };
}

function startRealtime(accountId: string) {
  if (typeof window === "undefined" || realtimeOwnerId === accountId) return;
  if (realtimeChannel) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  realtimeOwnerId = accountId;
  realtimeChannel = supabase
    .channel(`mobflow-state:${accountId}`)
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "app_state",
      filter: `owner_id=eq.${accountId}`,
    }, (payload) => {
      const remoteState = (payload.new as Record<string, unknown> | undefined)?.["state"];
      const remoteUpdatedAt = (payload.new as Record<string, unknown> | undefined)?.["updated_at"];
      if (!remoteState || typeof remoteState !== "object") return;
      const remote = remoteState as State;
      state = mergeConcurrentState(lastSyncedState, state, remote);
      lastSyncedState = cloneState(remote);
      lastCloudUpdatedAt = typeof remoteUpdatedAt === "string" ? remoteUpdatedAt : lastCloudUpdatedAt;
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
      listeners.forEach((l) => l());
    })
    .subscribe();
}

function persistState() {
  persistQueue = persistQueue.then(async () => {
    if (!cloudReady || typeof window === "undefined" || !cloudAccountId) return;
    const snapshot = cloneState(state);
    const expected = lastCloudUpdatedAt;
    let result;
    if (expected) {
      result = await supabase.from("app_state")
        .update({ state: snapshot, updated_at: new Date().toISOString() })
        .eq("owner_id", cloudAccountId)
        .eq("updated_at", expected)
        .select("updated_at")
        .maybeSingle();
    } else {
      result = await supabase.from("app_state")
        .upsert({ owner_id: cloudAccountId, state: snapshot, updated_at: new Date().toISOString() }, { onConflict: "owner_id" })
        .select("updated_at")
        .maybeSingle();
    }
    if (result.error) return;
    if (result.data?.updated_at) {
      lastCloudUpdatedAt = result.data.updated_at;
      lastSyncedState = cloneState(snapshot);
      return;
    }
    const { data } = await supabase.from("app_state").select("state,updated_at").eq("owner_id", cloudAccountId).maybeSingle();
    if (!data?.state) return;
    state = mergeConcurrentState(lastSyncedState, state, data.state as State);
    lastCloudUpdatedAt = data.updated_at ?? null;
    lastSyncedState = cloneState(data.state as State);
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
    const retry = cloneState(state);
    const retryResult = await supabase.from("app_state").update({ state: retry, updated_at: new Date().toISOString() }).eq("owner_id", cloudAccountId).eq("updated_at", lastCloudUpdatedAt).select("updated_at").maybeSingle();
    if (retryResult.data?.updated_at) {
      lastCloudUpdatedAt = retryResult.data.updated_at;
      lastSyncedState = cloneState(retry);
    }
  }).catch(() => {});
  return persistQueue;
}

export async function hydrateStore() {
  if (hydrating) return hydrating;
  hydrating = (async () => {
    load();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("profiles").select("account_id").eq("id", user.id).maybeSingle();
    const accountId = profile?.account_id ?? user.id;
    cloudAccountId = accountId;
    const { data, error } = await supabase
      .from("app_state")
      .select("state,updated_at")
      .eq("owner_id", accountId)
      .maybeSingle();

    const localOwner = localStorage.getItem(OWNER_KEY);
    if (!error && data?.state) {
      state = { ...state, ...data.state };
      lastCloudUpdatedAt = data.updated_at ?? null;
      lastSyncedState = cloneState(data.state as State);
    } else if (!error && !localOwner) {
      load();
    } else if (!error) {
      state = { products: seed, cart: [], sales: [], conferences: [], receiving: [], suppliers: [], settings: state.settings ?? { companyName: "" } };
    }

    try {
      localStorage.setItem(OWNER_KEY, accountId);
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
    cloudReady = true;
    startRealtime(accountId);
    if (!data?.state && !error) await persistState();
    listeners.forEach((l) => l());
  })().finally(() => { hydrating = null; });
  return hydrating;
}

function set(next: Partial<State>) {
  state = { ...state, ...next };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  if (cloudReady) void persistState();
  listeners.forEach((l) => l());
}

const serverState = state;
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => { load(); listeners.add(l); l(); return () => listeners.delete(l); },
    () => { load(); return sel(state); },
    () => sel(serverState),
  );
}

export const actions = {
  addToCart(productId: string, qty = 1) {
    const p = state.products.find((x) => x.id === productId);
    if (!p) return;
    const cur = state.cart.find((c) => c.productId === productId);
    const nextQty = Math.max(0, (cur?.qty ?? 0) + qty);
    if (nextQty > p.stock) return;
    const cart = nextQty === 0
      ? state.cart.filter((c) => c.productId !== productId)
      : cur ? state.cart.map((c) => (c.productId === productId ? { ...c, qty: nextQty } : c)) : [...state.cart, { productId, qty: nextQty }];
    set({ cart });
  },
  setCartQty(productId: string, qty: number) {
    const p = state.products.find((x) => x.id === productId);
    if (!p || !Number.isFinite(qty)) return;
    const normalized = p.unit === "kg" ? Math.round(Math.max(0, qty) * 1000) / 1000 : Math.floor(Math.max(0, qty));
    const nextQty = Math.min(p.stock, normalized);
    const cart = nextQty <= 0
      ? state.cart.filter((c) => c.productId !== productId)
      : state.cart.map((c) => c.productId === productId ? { ...c, qty: nextQty } : c);
    set({ cart });
  },
  removeFromCart(productId: string) { set({ cart: state.cart.filter((c) => c.productId !== productId) }); },
  clearCart() { set({ cart: [] }); },
  checkout(payment: Payment, received?: number, customer?: string, cpf?: string, discount = 0, discountType: "R$" | "%" = "R$"): Sale | null {
    if (!state.cart.length) return null;
    const items = state.cart.map((c) => {
      const p = state.products.find((x) => x.id === c.productId)!;
      return { name: p.name, price: p.price, cost: p.cost, qty: c.qty, unit: p.unit };
    });
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const discountValue = discountType === "%" ? subtotal * Math.min(100, Math.max(0, discount)) / 100 : Math.min(subtotal, Math.max(0, discount));
    const total = Math.max(0, subtotal - discountValue);
    const costTotal = items.reduce((sum, i) => sum + (i.cost ?? 0) * i.qty, 0);
    const profit = payment === "Fiado" ? 0 : total - costTotal;
    const sale: Sale = { id: uid(), date: new Date().toISOString(), items, total, profit, subtotal, discount: discountValue, discountType, payment, received, customer: customer || undefined, cpf: cpf || undefined, paid: payment !== "Fiado", paidAt: payment === "Fiado" ? undefined : new Date().toISOString(), payments: payment === "Fiado" ? [] : undefined };
    const products = state.products.map((p) => {
      const c = state.cart.find((x) => x.productId === p.id);
      return c ? { ...p, stock: Math.max(0, p.stock - c.qty) } : p;
    });
    set({ products, cart: [], sales: [sale, ...state.sales] });
    return sale;
  },
  addFiadoPayment(id: string, value: number) {
    const sale = state.sales.find((s) => s.id === id && s.payment === "Fiado");
    if (!sale || sale.paid || !Number.isFinite(value) || value <= 0) return false;
    const payments = sale.payments ?? (sale.paid ? [{ value: sale.total, date: sale.paidAt ?? sale.date }] : []);
    const alreadyPaid = payments.reduce((sum, p) => sum + p.value, 0);
    const remaining = Math.max(0, sale.total - alreadyPaid);
    const amount = Math.min(remaining, Math.round(value * 100) / 100);
    if (amount <= 0) return false;
    const nextPayments = [...payments, { value: amount, date: new Date().toISOString() }];
    const paidTotal = nextPayments.reduce((sum, p) => sum + p.value, 0);
    const isPaid = paidTotal >= sale.total - 0.005;
    const costTotal = sale.items.reduce((sum, i) => sum + (i.cost ?? 0) * i.qty, 0);
    const profit = isPaid ? sale.total - costTotal : 0;
    set({ sales: state.sales.map((s) => s.id === id ? { ...s, payments: nextPayments, paid: isPaid, paidAt: isPaid ? new Date().toISOString() : undefined, profit } : s) });
    return true;
  },
  markFiadoPaid(id: string) {
    const sale = state.sales.find((s) => s.id === id && s.payment === "Fiado");
    if (!sale || sale.paid) return;
    actions.addFiadoPayment(id, sale.total);
  },
  updateSettings(settings: AppSettings) { set({ settings }); },
  resetAppData() {
    set({ products: [], cart: [], sales: [], conferences: [], receiving: [], settings: state.settings });
  },
  saveProduct(p: Omit<Product, "id"> & { id?: string | undefined }) {
    if (p.id) set({ products: state.products.map((x) => (x.id === p.id ? { ...x, ...p, id: x.id } : x)) });
    else set({ products: [{ ...p, id: uid() }, ...state.products] });
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
    set({ products });
    return { created, updated };
  },
  updateField(id: string, field: "price" | "stock", value: number) {
    set({ products: state.products.map((x) => (x.id === id ? { ...x, [field]: value } : x)) });
  },
  deleteProduct(id: string) { set({ products: state.products.filter((x) => x.id !== id), cart: state.cart.filter((c) => c.productId !== id) }); },
  newConference(name: string): string {
    const c: Conference = { id: uid(), name: name || `Conferência ${new Date().toLocaleDateString("pt-BR")}`, date: new Date().toISOString(), status: "aberta", counts: {}, unknown: [] };
    set({ conferences: [c, ...(state.conferences ?? [])] });
    return c.id;
  },
  patchConference(id: string, fn: (c: Conference) => Conference) {
    set({ conferences: state.conferences.map((c) => (c.id === id ? fn(c) : c)) });
  },
  countCode(confId: string, code: string, qty = 1): Product | null {
    const p = state.products.find((x) => x.code === code.trim());
    actions.patchConference(confId, (c) => p
      ? { ...c, counts: { ...c.counts, [p.id]: Math.max(0, (c.counts[p.id] ?? 0) + qty) } }
      : { ...c, unknown: c.unknown.includes(code) ? c.unknown : [...c.unknown, code] });
    return p ?? null;
  },
  setCount(confId: string, productId: string, n: number) {
    actions.patchConference(confId, (c) => ({ ...c, counts: { ...c.counts, [productId]: Math.max(0, n) } }));
  },
  finishConference(id: string, adjust: boolean) {
    const conf = state.conferences.find((c) => c.id === id);
    if (!conf) return;
    const products = adjust ? state.products.map((p) => (p.id in conf.counts ? { ...p, stock: conf.counts[p.id]! } : p)) : state.products;
    set({ products, conferences: state.conferences.map((c) => (c.id === id ? { ...c, status: "finalizada", adjusted: adjust } : c)) });
  },
  createReceiving(number: string, supplier: string, supplierCnpj: string | undefined, items: { productId: string; expected: number }[]) {
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
    return receiving.id;
  },
  updateReceiving(id: string, patch: Partial<Pick<ReceivingNote, "number" | "supplier">>) {
    set({ receiving: (state.receiving ?? []).map((n) => n.id === id ? { ...n, ...patch } : n) });
  },
  addReceivingItems(id: string, items: { productId: string; expected: number }[]) {
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
    set({ receiving: (state.receiving ?? []).map((n) => n.id === id ? { ...n, items: merged } : n) });
  },
  startReceivingConference(receivingId: string) {
    const n = (state.receiving ?? []).find((x) => x.id === receivingId);
    if (!n || n.status !== "pendente") return null;
    const existing = state.conferences.find((c) => c.receivingId === receivingId && c.status === "aberta");
    if (existing) return existing.id;
    const c: Conference = {
      id: uid(), name: `Nota ${n.number} · ${n.supplier}`, date: new Date().toISOString(),
      status: "aberta", counts: {}, unknown: [], receivingId,
    };
    set({ conferences: [c, ...(state.conferences ?? [])] });
    return c.id;
  },
  finishReceivingConference(id: string) {
    const conf = state.conferences.find((c) => c.id === id);
    if (!conf?.receivingId) return;
    const note = (state.receiving ?? []).find((n) => n.id === conf.receivingId);
    if (!note) return;
    const divergent = note.items.some((i) => (conf.counts[i.productId] ?? 0) !== i.expected);
    set({
      receiving: (state.receiving ?? []).map((n) => n.id === note.id ? {
        ...n,
        items: n.items.map((i) => ({ ...i, received: conf.counts[i.productId] ?? 0 })),
        status: divergent ? "divergente" : "conferido",
        stockReleased: false,
      } : n),
      conferences: state.conferences.map((c) => c.id === id ? { ...c, status: "finalizada", adjusted: !divergent } : c),
    });
  },
  async acceptReceiving(id: string) {
    const note = (state.receiving ?? []).find((n) => n.id === id);
    if (!note || (note.status !== "divergente" && note.status !== "conferido") || note.stockReleased) return false;
    const { data, error } = await supabase.rpc("accept_receiving", { p_receiving_id: id });
    if (error || data !== true) {
      await hydrateStore();
      return false;
    }
    const products = state.products.map((p) => {
      const item = note.items.find((i) => i.productId === p.id);
      return item ? { ...p, stock: p.stock + (item.received ?? 0) } : p;
    });
    set({
      products,
      receiving: (state.receiving ?? []).map((n) => n.id === id ? { ...n, status: "aceito", stockReleased: true } : n),
    });
    return true;
  },
  rejectReceiving(id: string) {
    set({ receiving: (state.receiving ?? []).map((n) => n.id === id ? { ...n, status: "rejeitado", stockReleased: false } : n) });
  },
  deleteReceiving(id: string) {
    set({ receiving: (state.receiving ?? []).filter((n) => n.id !== id), conferences: state.conferences.filter((c) => c.receivingId !== id) });
  },
};

export const formatCpf = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};

export function printFiadoBalance(customer: string, sales: Sale[]) {
  const open = sales.filter((s) => s.payment === "Fiado" && (s.customer || "").trim() === customer.trim()).map((s) => {
    const paid = (s.payments ?? (s.paid ? [{ value: s.total, date: s.paidAt ?? s.date }] : [])).reduce((sum, p) => sum + p.value, 0);
    return { sale: s, remaining: Math.max(0, s.total - paid) };
  }).filter((x) => x.remaining > 0);
  const total = open.reduce((sum, x) => sum + x.remaining, 0);
  const rows = open.map(({ sale: s, remaining }) => `<tr><td>${new Date(s.date).toLocaleDateString("pt-BR")} · ${s.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</td><td style="text-align:right">R$ ${brl(remaining)}</td></tr>`).join("");
  const w = window.open("", "_blank", "width=420,height=700");
  if (!w) return;
  w.document.write(`<html><head><title>Saldo fiado - ${customer}</title><style>body{font-family:monospace;font-size:12px;width:320px;margin:12px auto}h1{text-align:center;font-size:18px}hr{border:0;border-top:1px dashed #000}table{width:100%}td{padding:4px 0;vertical-align:top}.c{text-align:center}</style></head><body><h1>CONTA FIADO</h1><p class="c">${customer}</p><hr/><table>${rows}</table><hr/><p><b>SALDO EM ABERTO: R$ ${brl(total)}</b></p><p class="c">Não é documento fiscal</p><script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

export function printReceipt(s: Sale) {
  const w = window.open("", "_blank", "width=380,height=640");
  if (!w) return;
  const rows = s.items.map((i) => { const qty = i.unit === "kg" ? `${brl(i.qty)} kg` : `${i.qty}×`; return `<tr><td>${qty} ${i.name}</td><td style="text-align:right">${brl(i.price * i.qty)}</td></tr>`; }).join("");
  w.document.write(`<html><head><title>Comprovante ${s.id}</title><style>body{font-family:monospace;font-size:12px;width:280px;margin:12px auto}h1{text-align:center;font-size:18px;margin:0}hr{border:0;border-top:1px dashed #000}table{width:100%}p{margin:2px 0}.c{text-align:center}</style></head><body>
<h1>MOBFLOW</h1><p class="c">COMPROVANTE DE COMPRA</p><p class="c">Não é documento fiscal</p><hr/>
<p>Data: ${new Date(s.date).toLocaleString("pt-BR")}</p><p>Nº: ${s.id.toUpperCase()}</p>
${s.customer ? `<p>Cliente: ${s.customer}</p>` : ""}${s.cpf ? `<p>CPF: ${s.cpf}</p>` : ""}<hr/>
<table>${rows}</table><hr/>
<table>${s.discount ? `<tr><td>Subtotal</td><td style="text-align:right">R$ ${brl(s.subtotal ?? s.total + s.discount)}</td></tr><tr><td>Desconto</td><td style="text-align:right">- R$ ${brl(s.discount)}</td></tr>` : ""}<tr><td><b>TOTAL</b></td><td style="text-align:right"><b>R$ ${brl(s.total)}</b></td></tr>
<tr><td>Pagamento</td><td style="text-align:right">${s.payment}</td></tr>
${s.received && s.received > s.total ? `<tr><td>Recebido</td><td style="text-align:right">${brl(s.received)}</td></tr><tr><td>Troco</td><td style="text-align:right">${brl(s.received - s.total)}</td></tr>` : ""}</table>
<hr/><p class="c">Obrigado pela preferência!</p><script>window.onload=()=>{window.print()}</script></body></html>`);
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
