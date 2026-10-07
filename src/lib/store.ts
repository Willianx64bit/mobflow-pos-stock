import { useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";

export type Product = { id: string; code: string; ref?: string; name: string; price: number; cost?: number; stock: number; minStock: number; category: string; unit: "un" | "kg"; photo?: string };
export type CartItem = { productId: string; qty: number };
export type Payment = "Dinheiro" | "Cartão" | "Pix";
export type Sale = { id: string; date: string; items: { name: string; price: number; cost?: number; qty: number; unit?: "un" | "kg" }[]; total: number; subtotal?: number; discount?: number; discountType?: "R$" | "%"; payment: Payment; received?: number | undefined; customer?: string | undefined; cpf?: string | undefined };
export type ReceivingItem = { productId: string; name: string; expected: number; received?: number; unit: "un" | "kg" };
export type ReceivingNote = {
  id: string;
  number: string;
  supplier: string;
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

type State = { products: Product[]; cart: CartItem[]; sales: Sale[]; conferences: Conference[]; receiving: ReceivingNote[] };

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

let state: State = { products: seed, cart: [], sales: [], conferences: [], receiving: [] };
let loaded = false;
let cloudReady = false;
let hydrating: Promise<void> | null = null;
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let realtimeOwnerId: string | null = null;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...state, ...JSON.parse(raw) };
    state.products = state.products.map((p) => ({ ...p, unit: p.unit === "kg" ? "kg" : "un" }));
  } catch {}
}
function startRealtime(userId: string) {
  if (typeof window === "undefined" || realtimeOwnerId === userId) return;
  if (realtimeChannel) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  realtimeOwnerId = userId;
  realtimeChannel = supabase
    .channel(`mobflow-state:${userId}`)
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "app_state",
      filter: `owner_id=eq.${userId}`,
    }, (payload) => {
      const remoteState = payload.new?.state;
      if (!remoteState || typeof remoteState !== "object") return;
      state = { ...state, ...remoteState } as State;
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
      listeners.forEach((l) => l());
    })
    .subscribe();
}

async function persistState() {
  if (!cloudReady || typeof window === "undefined") return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("app_state").upsert({
    owner_id: user.id,
    state,
    updated_at: new Date().toISOString(),
  });
}

export async function hydrateStore() {
  if (hydrating) return hydrating;
  hydrating = (async () => {
    load();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("app_state")
      .select("state")
      .eq("owner_id", user.id)
      .maybeSingle();

    const localOwner = localStorage.getItem(OWNER_KEY);
    if (!error && data?.state) {
      state = { ...state, ...data.state };
    } else if (!error && !localOwner) {
      // First cloud login: migrate the legacy local data once.
      load();
    } else if (!error) {
      // A different account must never inherit another account's browser data.
      state = { products: seed, cart: [], sales: [], conferences: [], receiving: [] };
    }

    try {
      localStorage.setItem(OWNER_KEY, user.id);
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
    cloudReady = true;
    startRealtime(user.id);
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
    const sale: Sale = { id: uid(), date: new Date().toISOString(), items, total, subtotal, discount: discountValue, discountType, payment, received, customer: customer || undefined, cpf: cpf || undefined };
    const products = state.products.map((p) => {
      const c = state.cart.find((x) => x.productId === p.id);
      return c ? { ...p, stock: Math.max(0, p.stock - c.qty) } : p;
    });
    set({ products, cart: [], sales: [sale, ...state.sales] });
    return sale;
  },
  saveProduct(p: Omit<Product, "id"> & { id?: string | undefined }) {
    if (p.id) set({ products: state.products.map((x) => (x.id === p.id ? { ...x, ...p, id: x.id } : x)) });
    else set({ products: [{ ...p, id: uid() }, ...state.products] });
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
  createReceiving(number: string, supplier: string, items: { productId: string; expected: number }[]) {
    const receiving: ReceivingNote = {
      id: uid(), number: number.trim() || "Sem número", supplier: supplier.trim() || "Fornecedor não informado",
      date: new Date().toISOString(),
      items: items.map((i) => {
        const p = state.products.find((x) => x.id === i.productId)!;
        return { productId: p.id, name: p.name, expected: Math.max(0, i.expected), unit: p.unit };
      }),
      status: "pendente",
    };
    set({ receiving: [receiving, ...(state.receiving ?? [])] });
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
  acceptReceiving(id: string) {
    const note = (state.receiving ?? []).find((n) => n.id === id);
    if (!note || (note.status !== "divergente" && note.status !== "conferido") || note.stockReleased) return;
    const products = state.products.map((p) => {
      const item = note.items.find((i) => i.productId === p.id);
      return item ? { ...p, stock: p.stock + (item.received ?? 0) } : p;
    });
    set({
      products,
      receiving: (state.receiving ?? []).map((n) => n.id === id ? { ...n, status: "aceito", stockReleased: true } : n),
    });
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

export const brl = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
