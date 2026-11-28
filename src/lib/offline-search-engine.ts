import { Index, IndexedDB } from "flexsearch";

export type OfflineSearchDocument = {
  id: string;
  name: string;
  code: string;
  barcodes?: string[];
  category?: string;
};

export type OfflineSearchDelta = {
  previous?: OfflineSearchDocument;
  next?: OfflineSearchDocument;
};

type SearchMeta = {
  tenantId: string;
  schema: number;
  count: number;
  xor: number;
  sum: number;
};

const META_DB = "mobflow-offline-search-meta";
const META_STORE = "indexes";
const SEARCH_SCHEMA = 1;
const BATCH_SIZE = 500;

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function offlineSearchText(product: OfflineSearchDocument): string {
  return normalize([
    product.name,
    product.code,
    ...(product.barcodes ?? []),
    product.category ?? "",
  ].join(" "));
}

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function fingerprint(products: OfflineSearchDocument[]) {
  let xor = 0;
  let sum = 0;
  let count = 0;
  for (const product of products) {
    if (!product.id) continue;
    const text = offlineSearchText(product);
    if (!text) continue;
    const value = hash(product.id + "\u0000" + text);
    xor = (xor ^ value) >>> 0;
    sum = (sum + value) >>> 0;
    count += 1;
  }
  return { count, xor, sum };
}

function openMetaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(META_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(META_STORE)) {
        request.result.createObjectStore(META_STORE, { keyPath: "tenantId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir os metadados da busca offline."));
  });
}

async function readMeta(tenantId: string): Promise<SearchMeta | null> {
  const db = await openMetaDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readonly");
      const request = tx.objectStore(META_STORE).get(tenantId);
      request.onsuccess = () => resolve((request.result as SearchMeta | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Falha ao ler o índice de busca offline."));
    });
  } finally {
    db.close();
  }
}

async function writeMeta(meta: SearchMeta): Promise<void> {
  const db = await openMetaDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Falha ao salvar o índice de busca offline."));
      tx.onabort = () => reject(tx.error ?? new Error("Gravação do índice offline cancelada."));
    });
  } finally {
    db.close();
  }
}

function safeTenantKey(tenantId: string): string {
  return encodeURIComponent(tenantId).replace(/%/g, "_").slice(0, 120);
}

export class OfflineProductSearchEngine {
  private index: Index<false, IndexedDB> | null = null;
  private tenantId = "";
  private meta: SearchMeta | null = null;

  async initialize(tenantId: string, products: OfflineSearchDocument[]) {
    if (!tenantId) throw new Error("Empresa não identificada para a pesquisa offline.");
    if (this.tenantId !== tenantId || !this.index) {
      this.tenantId = tenantId;
      this.meta = null;
      this.index = new Index<false, IndexedDB>({
        tokenize: "forward",
        encoder: { numeric: false },
        cache: 1000,
        commit: false,
      });
      await this.index.mount(new IndexedDB("mobflow-product-search-v1-" + safeTenantKey(tenantId)));
    }

    const nextMeta = { tenantId, schema: SEARCH_SCHEMA, ...fingerprint(products) };
    const stored = await readMeta(tenantId);
    if (stored && stored.schema === SEARCH_SCHEMA &&
        stored.count === nextMeta.count && stored.xor === nextMeta.xor && stored.sum === nextMeta.sum) {
      this.meta = stored;
      return { ready: true, rebuilt: false, count: stored.count };
    }

    // Invalidate the previous marker before clearing/rebuilding. If the app
    // closes mid-build, the next launch must never trust a partial index.
    await writeMeta({ tenantId, schema: SEARCH_SCHEMA, count: -1, xor: 0, sum: 0 });
    await this.index.clear();
    for (let offset = 0; offset < products.length; offset += BATCH_SIZE) {
      const batch = products.slice(offset, offset + BATCH_SIZE);
      for (const product of batch) {
        const text = offlineSearchText(product);
        if (product.id && text) this.index.add(product.id, text);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    // One bulk commit avoids rewriting the growing persistent index after
    // every small batch (which would make a large initial build quadratic).
    await this.index.commit();
    await writeMeta(nextMeta);
    this.meta = nextMeta;
    return { ready: true, rebuilt: true, count: nextMeta.count };
  }

  async close(): Promise<void> {
    if (!this.index) return;
    const storage = await this.index.db;
    await storage.close();
    this.index = null;
    this.meta = null;
    this.tenantId = "";
  }

  async search(query: string, limit = 100): Promise<string[]> {
    if (!this.index || !this.tenantId) throw new Error("A pesquisa offline ainda não foi preparada.");
    const term = normalize(query.trim());
    if (term.length < 2) return [];
    const results = await this.index.search(term, Math.max(1, Math.min(100, Math.floor(limit))));
    return results.map(String);
  }

  async applyDelta(changes: OfflineSearchDelta[]): Promise<void> {
    if (!this.index || !this.meta || !changes.length) return;
    let { count, xor, sum } = this.meta;
    let changed = false;

    for (const change of changes) {
      const previous = change.previous;
      const next = change.next;
      const oldText = previous ? offlineSearchText(previous) : "";
      const nextText = next ? offlineSearchText(next) : "";
      const oldHash = previous?.id && oldText ? hash(previous.id + "\u0000" + oldText) : null;
      const nextHash = next?.id && nextText ? hash(next.id + "\u0000" + nextText) : null;
      if (oldHash === nextHash && previous?.id === next?.id) continue;

      if (previous?.id && oldHash !== null) {
        xor = (xor ^ oldHash) >>> 0;
        sum = (sum - oldHash) >>> 0;
        count = Math.max(0, count - 1);
      }
      if (next?.id && nextHash !== null) {
        xor = (xor ^ nextHash) >>> 0;
        sum = (sum + nextHash) >>> 0;
        count += 1;
      }

      if (previous?.id) this.index.remove(previous.id);
      if (next?.id && nextText) this.index.add(next.id, nextText);
      changed = true;
    }

    if (changed) {
      await this.index.commit();
      this.meta = { tenantId: this.tenantId, schema: SEARCH_SCHEMA, count, xor, sum };
      await writeMeta(this.meta);
    }
  }
}
