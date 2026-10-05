import { useSyncExternalStore } from "react";

export type Product = { id: string; code: string; name: string; price: number; stock: number; minStock: number; category: string };
export type CartItem = { productId: string; qty: number };
export type Payment = "Dinheiro" | "Cartão" | "Pix";
export type Sale = { id: string; date: string; items: { name: string; price: number; qty: number }[]; total: number; payment: Payment; received?: number };

type State = { products: Product[]; cart: CartItem[]; sales: Sale[] };

const KEY = "mobflow:v1";
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
  id: uid(), code: code as string, name: name as string, price: price as number, stock: stock as number, minStock: 5, category: category as string,
}));

let state: State = { products: seed, cart: [], sales: [] };
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...state, ...JSON.parse(raw) };
  } catch {}
}
function set(next: Partial<State>) {
  state = { ...state, ...next };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
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
    const cart = nextQty === 0
      ? state.cart.filter((c) => c.productId !== productId)
      : cur ? state.cart.map((c) => (c.productId === productId ? { ...c, qty: nextQty } : c)) : [...state.cart, { productId, qty: nextQty }];
    set({ cart });
  },
  removeFromCart(productId: string) { set({ cart: state.cart.filter((c) => c.productId !== productId) }); },
  clearCart() { set({ cart: [] }); },
  checkout(payment: Payment, received?: number): Sale | null {
    if (!state.cart.length) return null;
    const items = state.cart.map((c) => {
      const p = state.products.find((x) => x.id === c.productId)!;
      return { name: p.name, price: p.price, qty: c.qty };
    });
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);
    const sale: Sale = { id: uid(), date: new Date().toISOString(), items, total, payment, received };
    const products = state.products.map((p) => {
      const c = state.cart.find((x) => x.productId === p.id);
      return c ? { ...p, stock: p.stock - c.qty } : p;
    });
    set({ products, cart: [], sales: [sale, ...state.sales] });
    return sale;
  },
  saveProduct(p: Omit<Product, "id"> & { id?: string }) {
    if (p.id) set({ products: state.products.map((x) => (x.id === p.id ? { ...x, ...p, id: x.id } : x)) });
    else set({ products: [{ ...p, id: uid() }, ...state.products] });
  },
  updateField(id: string, field: "price" | "stock", value: number) {
    set({ products: state.products.map((x) => (x.id === id ? { ...x, [field]: value } : x)) });
  },
  deleteProduct(id: string) { set({ products: state.products.filter((x) => x.id !== id), cart: state.cart.filter((c) => c.productId !== id) }); },
};

export const brl = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
