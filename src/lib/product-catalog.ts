export type OfflineCatalogProduct = {
  id: string;
  code: string;
  barcodes?: string[] | undefined;
  ref?: string | undefined;
  name: string;
  price: number;
  cost?: number | undefined;
  stock: number;
  minStock: number;
  category: string;
  unit: "un" | "kg";
  active?: boolean | undefined;
  version?: number | undefined;
  photoObjectKey?: string | undefined;
  photo?: string | undefined;
};

type CatalogRecord = OfflineCatalogProduct & { tenantId: string; generation: string; normalizedName: string };
type CatalogMeta = { tenantId: string; activeGeneration?: string; syncedAt?: number; count?: number; pendingGeneration?: string; pendingCursor?: string | null; pendingCount?: number; pendingComplete?: boolean; pendingStartedAt?: number };

const DB_NAME = "mobflow-product-catalog";
const DB_VERSION = 1;
const PRODUCT_STORE = "products";
const META_STORE = "metadata";

function openCatalogDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB indisponível neste dispositivo."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
        const store = db.createObjectStore(PRODUCT_STORE, { keyPath: ["tenantId", "generation", "id"] });
        store.createIndex("tenantGeneration", ["tenantId", "generation"], { unique: false });
        store.createIndex("tenantGenerationName", ["tenantId", "generation", "normalizedName"], { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "tenantId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o catálogo local."));
    request.onblocked = () => reject(new Error("A atualização do catálogo local está bloqueada por outra janela."));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao acessar o catálogo local."));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Falha ao gravar o catálogo local."));
    tx.onabort = () => reject(tx.error ?? new Error("Gravação do catálogo local cancelada."));
  });
}

function cleanProduct(product: OfflineCatalogProduct): OfflineCatalogProduct {
  const { photo: _photo, ...safe } = product as OfflineCatalogProduct & { photo?: string };
  return { ...safe, barcodes: Array.isArray(safe.barcodes) ? [...safe.barcodes] : [] };
}

export async function readOfflineCatalog(tenantId: string): Promise<{ products: OfflineCatalogProduct[]; syncedAt: number | null; hasCatalog: boolean }> {
  const db = await openCatalogDb();
  try {
    const tx = db.transaction([PRODUCT_STORE, META_STORE], "readonly");
    const done = transactionDone(tx);
    const meta = await requestValue(tx.objectStore(META_STORE).get(tenantId)) as CatalogMeta | undefined;
    if (!meta?.activeGeneration) {
      await done;
      return { products: [], syncedAt: null, hasCatalog: false };
    }
    const index = tx.objectStore(PRODUCT_STORE).index("tenantGeneration");
    const range = IDBKeyRange.only([tenantId, meta.activeGeneration]);
    const records = await requestValue(index.getAll(range)) as CatalogRecord[];
    await done;
    return { products: records.map(({ tenantId: _t, generation: _g, normalizedName: _n, ...product }) => product), syncedAt: meta.syncedAt ?? null, hasCatalog: true };
  } finally {
    db.close();
  }
}

/** Reads only committed catalog metadata; useful for validating offline readiness without loading every product. */
export async function getOfflineCatalogStatus(tenantId: string): Promise<{ count: number; syncedAt: number | null; hasCatalog: boolean }> {
  const db = await openCatalogDb();
  try {
    const tx = db.transaction(META_STORE, "readonly");
    const done = transactionDone(tx);
    const meta = await requestValue(tx.objectStore(META_STORE).get(tenantId)) as CatalogMeta | undefined;
    await done;
    const count = Number(meta?.count ?? 0);
    const hasCatalog = Boolean(meta?.activeGeneration && count > 0);
    return { count: Number.isFinite(count) ? count : 0, syncedAt: meta?.syncedAt ?? null, hasCatalog };
  } finally {
    db.close();
  }
}

/** Returns the durable checkpoint for an interrupted catalog download. */
export async function getOfflineCatalogSyncState(tenantId: string): Promise<{ pending: boolean; cursor: string | null; count: number; complete: boolean }> {
  const db = await openCatalogDb();
  try {
    const tx = db.transaction(META_STORE, "readonly");
    const done = transactionDone(tx);
    const meta = await requestValue(tx.objectStore(META_STORE).get(tenantId)) as CatalogMeta | undefined;
    await done;
    const pending = Boolean(meta?.pendingGeneration);
    return {
      pending,
      cursor: pending ? meta?.pendingCursor ?? null : null,
      count: pending ? Number(meta?.pendingCount ?? 0) : 0,
      complete: pending && meta?.pendingComplete === true,
    };
  } finally {
    db.close();
  }
}

/** Reads only the uncommitted generation so a restarted download can continue from its saved cursor. */
export async function readPendingOfflineCatalog(tenantId: string): Promise<OfflineCatalogProduct[]> {
  const db = await openCatalogDb();
  try {
    const tx = db.transaction([PRODUCT_STORE, META_STORE], "readonly");
    const done = transactionDone(tx);
    const meta = await requestValue(tx.objectStore(META_STORE).get(tenantId)) as CatalogMeta | undefined;
    if (!meta?.pendingGeneration) {
      await done;
      return [];
    }
    const index = tx.objectStore(PRODUCT_STORE).index("tenantGenerationName");
    const range = IDBKeyRange.bound([tenantId, meta.pendingGeneration, ""], [tenantId, meta.pendingGeneration, "\uffff"]);
    const records = await requestValue(index.getAll(range)) as CatalogRecord[];
    await done;
    return records.map(({ tenantId: _t, generation: _g, normalizedName: _n, ...product }) => product);
  } finally {
    db.close();
  }
}

/** Atomically stores a downloaded page and its next cursor; both survive closing the app. */
export async function writeOfflineCatalogPage(tenantId: string, products: OfflineCatalogProduct[], nextCursor: string | null): Promise<number> {
  if (!tenantId) throw new Error("Empresa inválida para salvar o catálogo.");
  const db = await openCatalogDb();
  try {
    const tx = db.transaction([PRODUCT_STORE, META_STORE], "readwrite");
    const done = transactionDone(tx);
    const metaStore = tx.objectStore(META_STORE);
    const previous = await requestValue(metaStore.get(tenantId)) as CatalogMeta | undefined;
    const generation = previous?.pendingGeneration ?? (
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(Date.now()) + Math.random().toString(36).slice(2)
    );
    const count = (previous?.pendingGeneration ? Number(previous.pendingCount ?? 0) : 0) + products.length;
    const store = tx.objectStore(PRODUCT_STORE);
    for (const product of products) {
      const clean = cleanProduct(product);
      const record: CatalogRecord = {
        ...clean,
        tenantId,
        generation,
        normalizedName: clean.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR"),
      };
      store.put(record);
    }
    metaStore.put({
      tenantId,
      ...(previous?.activeGeneration ? { activeGeneration: previous.activeGeneration } : {}),
      ...(previous?.syncedAt ? { syncedAt: previous.syncedAt } : {}),
      count: Number(previous?.count ?? 0),
      pendingGeneration: generation,
      pendingCursor: nextCursor,
      pendingCount: count,
      pendingComplete: nextCursor === null,
      pendingStartedAt: previous?.pendingGeneration ? previous.pendingStartedAt ?? Date.now() : Date.now(),
    } satisfies CatalogMeta);
    await done;
    return count;
  } finally {
    db.close();
  }
}

/** Switches readers to the new generation only after the final page checkpoint is durable. */
export async function commitOfflineCatalogSync(tenantId: string): Promise<number> {
  const db = await openCatalogDb();
  try {
    const tx = db.transaction(META_STORE, "readwrite");
    const done = transactionDone(tx);
    const metaStore = tx.objectStore(META_STORE);
    const previous = await requestValue(metaStore.get(tenantId)) as CatalogMeta | undefined;
    if (!previous?.pendingGeneration) {
      await done;
      return Number(previous?.count ?? 0);
    }
    if (previous.pendingComplete !== true) {
      await done;
      throw new Error("O catálogo ainda possui páginas pendentes de sincronização.");
    }
    const previousGeneration = previous.activeGeneration;
    const generation = previous.pendingGeneration;
    const count = Number(previous.pendingCount ?? 0);
    metaStore.put({ tenantId, activeGeneration: generation, syncedAt: Date.now(), count } satisfies CatalogMeta);
    await done;

    if (previousGeneration && previousGeneration !== generation) {
      const cleanup = db.transaction(PRODUCT_STORE, "readwrite");
      const cleanupDone = transactionDone(cleanup);
      const index = cleanup.objectStore(PRODUCT_STORE).index("tenantGeneration");
      const cursor = index.openKeyCursor(IDBKeyRange.only([tenantId, previousGeneration]));
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (current) {
          cleanup.objectStore(PRODUCT_STORE).delete(current.primaryKey);
          current.continue();
        }
      };
      await cleanupDone.catch(() => undefined);
    }
    return count;
  } finally {
    db.close();
  }
}

/** Writes each page into an inactive generation; readers keep using the previous complete generation until commit. */
export async function replaceOfflineCatalog(tenantId: string, pages: AsyncIterable<OfflineCatalogProduct[]>): Promise<number> {
  if (!tenantId) throw new Error("Empresa inválida para salvar o catálogo.");
  const db = await openCatalogDb();
  const generation = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
  let count = 0;
  try {
    for await (const page of pages) {
      if (!page.length) continue;
      const tx = db.transaction(PRODUCT_STORE, "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore(PRODUCT_STORE);
      for (const product of page) {
        const clean = cleanProduct(product);
        const record: CatalogRecord = { ...clean, tenantId, generation, normalizedName: clean.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR") };
        store.put(record);
        count += 1;
      }
      await done;
    }
    const metaTx = db.transaction(META_STORE, "readwrite");
    const metaDone = transactionDone(metaTx);
    const metaStore = metaTx.objectStore(META_STORE);
    const previous = await requestValue(metaStore.get(tenantId)) as CatalogMeta | undefined;
    metaStore.put({ tenantId, activeGeneration: generation, syncedAt: Date.now(), count } satisfies CatalogMeta);
    await metaDone;

    // Cleanup is best-effort and only happens after the new generation is active.
    const obsoleteGenerations = [...new Set([previous?.activeGeneration, previous?.pendingGeneration]
      .filter((old): old is string => Boolean(old) && old !== generation))];
    for (const obsolete of obsoleteGenerations) {
      const cleanup = db.transaction(PRODUCT_STORE, "readwrite");
      const cleanupDone = transactionDone(cleanup);
      const index = cleanup.objectStore(PRODUCT_STORE).index("tenantGeneration");
      const cursor = index.openKeyCursor(IDBKeyRange.only([tenantId, obsolete]));
      cursor.onsuccess = () => { const current = cursor.result; if (current) { cleanup.objectStore(PRODUCT_STORE).delete(current.primaryKey); current.continue(); } };
      await cleanupDone.catch(() => undefined);
    }
    return count;
  } catch (error) {
    // Failed staging generation is never made visible; old committed catalog remains intact.
    const cleanup = db.transaction(PRODUCT_STORE, "readwrite");
    const cleanupDone = transactionDone(cleanup);
    const index = cleanup.objectStore(PRODUCT_STORE).index("tenantGeneration");
    const cursor = index.openKeyCursor(IDBKeyRange.only([tenantId, generation]));
    cursor.onsuccess = () => { const current = cursor.result; if (current) { cleanup.objectStore(PRODUCT_STORE).delete(current.primaryKey); current.continue(); } };
    await cleanupDone.catch(() => undefined);
    throw error;
  } finally {
    db.close();
  }
}

export async function upsertOfflineCatalogProducts(tenantId: string, products: OfflineCatalogProduct[]): Promise<void> {
  if (!products.length) return;
  const db = await openCatalogDb();
  try {
    const metaTx = db.transaction(META_STORE, "readonly");
    const metaDone = transactionDone(metaTx);
    const meta = await requestValue(metaTx.objectStore(META_STORE).get(tenantId)) as CatalogMeta | undefined;
    await metaDone;
    const generations = [...new Set([meta?.activeGeneration, meta?.pendingGeneration].filter((value): value is string => Boolean(value)))];
    if (!generations.length) return;
    const tx = db.transaction(PRODUCT_STORE, "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore(PRODUCT_STORE);
    for (const product of products) {
      const clean = cleanProduct(product);
      for (const generation of generations) {
        store.put({ ...clean, tenantId, generation, normalizedName: clean.name.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLocaleLowerCase("pt-BR") } satisfies CatalogRecord);
      }
    }
    await done;
  } finally { db.close(); }
}

export async function upsertOfflineCatalogProduct(tenantId: string, product: OfflineCatalogProduct): Promise<void> {
  const db = await openCatalogDb();
  try {
    const metaTx = db.transaction(META_STORE, "readonly");
    const metaDone = transactionDone(metaTx);
    const meta = await requestValue(metaTx.objectStore(META_STORE).get(tenantId)) as CatalogMeta | undefined;
    await metaDone;
    const generations = [...new Set([meta?.activeGeneration, meta?.pendingGeneration].filter((value): value is string => Boolean(value)))];
    if (!generations.length) return;
    const clean = cleanProduct(product);
    const tx = db.transaction(PRODUCT_STORE, "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore(PRODUCT_STORE);
    for (const generation of generations) {
      store.put({ ...clean, tenantId, generation, normalizedName: clean.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR") } satisfies CatalogRecord);
    }
    await done;
  } finally { db.close(); }
}

export async function removeOfflineCatalogProduct(tenantId: string, productId: string): Promise<void> {
  const db = await openCatalogDb();
  try {
    const metaTx = db.transaction(META_STORE, "readonly");
    const metaDone = transactionDone(metaTx);
    const meta = await requestValue(metaTx.objectStore(META_STORE).get(tenantId)) as CatalogMeta | undefined;
    await metaDone;
    const generations = [...new Set([meta?.activeGeneration, meta?.pendingGeneration].filter((value): value is string => Boolean(value)))];
    if (!generations.length) return;
    const tx = db.transaction(PRODUCT_STORE, "readwrite");
    const done = transactionDone(tx);
    const store = tx.objectStore(PRODUCT_STORE);
    for (const generation of generations) store.delete([tenantId, generation, productId]);
    await done;
  } finally { db.close(); }
}
