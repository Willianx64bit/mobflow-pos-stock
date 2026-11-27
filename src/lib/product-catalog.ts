export type OfflineCatalogProduct = {
  id: string;
  code: string;
  barcodes?: string[];
  ref?: string;
  name: string;
  price: number;
  cost?: number;
  stock: number;
  minStock: number;
  category: string;
  unit: "un" | "kg";
  active?: boolean;
  version?: number;
  photoObjectKey?: string;
};

type CatalogRecord = OfflineCatalogProduct & { tenantId: string; generation: string; normalizedName: string };
type CatalogMeta = { tenantId: string; activeGeneration: string; syncedAt: number; count: number };

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
    const meta = await requestValue(tx.objectStore(META_STORE).get(tenantId)) as CatalogMeta | undefined;
    if (!meta?.activeGeneration) return { products: [], syncedAt: null, hasCatalog: false };
    const index = tx.objectStore(PRODUCT_STORE).index("tenantGeneration");
    const range = IDBKeyRange.only([tenantId, meta.activeGeneration]);
    const records = await requestValue(index.getAll(range)) as CatalogRecord[];
    await transactionDone(tx);
    return { products: records.map(({ tenantId: _t, generation: _g, normalizedName: _n, ...product }) => product), syncedAt: meta.syncedAt, hasCatalog: true };
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
      const store = tx.objectStore(PRODUCT_STORE);
      for (const product of page) {
        const clean = cleanProduct(product);
        const record: CatalogRecord = { ...clean, tenantId, generation, normalizedName: clean.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR") };
        store.put(record);
        count += 1;
      }
      await transactionDone(tx);
    }
    const metaTx = db.transaction(META_STORE, "readwrite");
    const metaStore = metaTx.objectStore(META_STORE);
    const previous = await requestValue(metaStore.get(tenantId)) as CatalogMeta | undefined;
    metaStore.put({ tenantId, activeGeneration: generation, syncedAt: Date.now(), count } satisfies CatalogMeta);
    await transactionDone(metaTx);

    // Cleanup is best-effort and only happens after the new generation is active.
    if (previous?.activeGeneration && previous.activeGeneration !== generation) {
      const cleanup = db.transaction(PRODUCT_STORE, "readwrite");
      const index = cleanup.objectStore(PRODUCT_STORE).index("tenantGeneration");
      const cursor = index.openKeyCursor(IDBKeyRange.only([tenantId, previous.activeGeneration]));
      cursor.onsuccess = () => { const current = cursor.result; if (current) { cleanup.objectStore(PRODUCT_STORE).delete(current.primaryKey); current.continue(); } };
      await transactionDone(cleanup).catch(() => undefined);
    }
    return count;
  } catch (error) {
    // Failed staging generation is never made visible; old committed catalog remains intact.
    const cleanup = db.transaction(PRODUCT_STORE, "readwrite");
    const index = cleanup.objectStore(PRODUCT_STORE).index("tenantGeneration");
    const cursor = index.openKeyCursor(IDBKeyRange.only([tenantId, generation]));
    cursor.onsuccess = () => { const current = cursor.result; if (current) { cleanup.objectStore(PRODUCT_STORE).delete(current.primaryKey); current.continue(); } };
    await transactionDone(cleanup).catch(() => undefined);
    throw error;
  } finally {
    db.close();
  }
}

export async function upsertOfflineCatalogProduct(tenantId: string, product: OfflineCatalogProduct): Promise<void> {
  const db = await openCatalogDb();
  try {
    const metaTx = db.transaction(META_STORE, "readonly");
    const meta = await requestValue(metaTx.objectStore(META_STORE).get(tenantId)) as CatalogMeta | undefined;
    await transactionDone(metaTx);
    if (!meta?.activeGeneration) return;
    const clean = cleanProduct(product);
    const tx = db.transaction(PRODUCT_STORE, "readwrite");
    tx.objectStore(PRODUCT_STORE).put({ ...clean, tenantId, generation: meta.activeGeneration, normalizedName: clean.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR") } satisfies CatalogRecord);
    await transactionDone(tx);
  } finally { db.close(); }
}

export async function removeOfflineCatalogProduct(tenantId: string, productId: string): Promise<void> {
  const db = await openCatalogDb();
  try {
    const metaTx = db.transaction(META_STORE, "readonly");
    const meta = await requestValue(metaTx.objectStore(META_STORE).get(tenantId)) as CatalogMeta | undefined;
    await transactionDone(metaTx);
    if (!meta?.activeGeneration) return;
    const tx = db.transaction(PRODUCT_STORE, "readwrite");
    tx.objectStore(PRODUCT_STORE).delete([tenantId, meta.activeGeneration, productId]);
    await transactionDone(tx);
  } finally { db.close(); }
}
