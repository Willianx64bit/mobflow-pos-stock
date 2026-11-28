import type { Product } from "@/lib/store";
import type { OfflineSearchDelta, OfflineSearchDocument } from "@/lib/offline-search-engine";

export type LocalProductSearchIndex = { products: Product[]; searchText: string[] };

const normalizedProductTextCache = new WeakMap<Product, string>();
function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}
function normalizedProductSearchText(product: Product): string {
  const cached = normalizedProductTextCache.get(product);
  if (cached !== undefined) return cached;
  const value = [
    normalizeSearchText(product.name),
    normalizeSearchText(product.code),
    ...(product.barcodes ?? []).map(normalizeSearchText),
    normalizeSearchText(product.category),
  ].join("\u001f");
  normalizedProductTextCache.set(product, value);
  return value;
}

export function buildProductBarcodeIndex(products: Product[], supplemental: Product[] = []): Map<string, Product> {
  const index = new Map<string, Product>();
  for (const product of supplemental) {
    const code = product.code.trim();
    if (code) index.set(code, product);
    for (const barcode of product.barcodes ?? []) {
      const value = barcode.trim();
      if (value) index.set(value, product);
    }
  }
  for (const product of products) {
    const code = product.code.trim();
    if (code && !index.has(code)) index.set(code, product);
    for (const barcode of product.barcodes ?? []) {
      const value = barcode.trim();
      if (value && !index.has(value)) index.set(value, product);
    }
  }
  return index;
}

export function buildLocalProductSearchIndex(products: Product[]): LocalProductSearchIndex {
  return { products, searchText: products.map(normalizedProductSearchText) };
}

export function searchIndexedLocalProducts(index: LocalProductSearchIndex, query: string, limit = 100): Product[] {
  const max = Math.max(1, Math.min(100, Math.floor(limit)));
  const term = normalizeSearchText(query.trim());
  if (!term) return index.products.slice(0, max);
  const matches: Product[] = [];
  for (let position = 0; position < index.products.length && matches.length < max; position += 1) {
    if (index.searchText[position]?.includes(term)) matches.push(index.products[position]);
  }
  return matches;
}

export function searchLocalProducts(products: Product[], query: string, limit = 100): Product[] {
  return searchIndexedLocalProducts(buildLocalProductSearchIndex(products), query, limit);
}

export type OfflineProductSearchClient = {
  initialize(products: Product[]): Promise<{ ready: boolean; rebuilt: boolean; count: number }>;
  search(query: string, limit?: number): Promise<string[]>;
  applyDelta(changes: OfflineSearchDelta[]): Promise<void>;
  destroy(): void;
};

const activeClients = new Map<string, OfflineProductSearchClient>();

function toSearchDocument(product: Product): OfflineSearchDocument | undefined {
  if (!product.id || !Number.isFinite(product.price) || product.price <= 0.01) return undefined;
  return {
    id: product.id,
    name: product.name,
    code: product.code,
    barcodes: product.barcodes ?? [],
    category: product.category ?? "",
  };
}

export function createOfflineProductSearchClient(tenantId: string): OfflineProductSearchClient {
  const worker = new Worker(new URL("./product-search.worker.ts", import.meta.url), { type: "module" });
  let nextId = 0;
  let closed = false;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

  worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const message = event.data;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error || "Falha na pesquisa offline."));
  };
  worker.onerror = () => {
    for (const request of pending.values()) request.reject(new Error("O processo de pesquisa offline foi interrompido."));
    pending.clear();
  };

  const send = <T>(message: Record<string, unknown>): Promise<T> => {
    if (closed) return Promise.reject(new Error("O mecanismo de pesquisa offline foi encerrado."));
    const id = ++nextId;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id });
    });
  };

  const client: OfflineProductSearchClient = {
    initialize: (products) => send<{ ready: boolean; rebuilt: boolean; count: number }>({ type: "initialize", tenantId, products: products.map(toSearchDocument).filter((item): item is OfflineSearchDocument => Boolean(item)) }),
    search: (query, limit = 100) => send<string[]>({ type: "search", query, limit }),
    applyDelta: (changes) => {
      const deltas: OfflineSearchDelta[] = changes.map((change) => ({
        ...(change.previous ? { previous: toSearchDocument(change.previous) } : {}),
        ...(change.next ? { next: toSearchDocument(change.next) } : {}),
      })).filter((change) => Boolean(change.previous || change.next));
      return deltas.length ? send<void>({ type: "delta", changes: deltas }) : Promise.resolve();
    },
    destroy: () => {
      closed = true;
      worker.terminate();
      for (const request of pending.values()) request.reject(new Error("Pesquisa offline encerrada."));
      pending.clear();
      if (activeClients.get(tenantId) === client) activeClients.delete(tenantId);
    },
  };
  activeClients.get(tenantId)?.destroy();
  activeClients.set(tenantId, client);
  return client;
}

export async function syncOfflineProductSearchDelta(
  tenantId: string,
  changes: Array<{ previous?: Product; next?: Product }>,
): Promise<void> {
  const client = activeClients.get(tenantId);
  if (!client || !changes.length) return;
  const relevant = changes.filter(({ previous, next }) => {
    const before = previous ? toSearchDocument(previous) : undefined;
    const after = next ? toSearchDocument(next) : undefined;
    if (!before && !after) return false;
    if (!before || !after) return true;
    return normalizedProductSearchText(previous!) !== normalizedProductSearchText(next!);
  });
  if (relevant.length) await client.applyDelta(relevant);
}

export async function refreshOfflineProductSearchIndex(tenantId: string, products: Product[]): Promise<void> {
  const client = activeClients.get(tenantId);
  if (client) await client.initialize(products);
}
