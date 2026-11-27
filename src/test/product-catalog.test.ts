import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { getOfflineCatalogStatus, readOfflineCatalog, replaceOfflineCatalog, upsertOfflineCatalogProduct, type OfflineCatalogProduct } from "@/lib/product-catalog";

async function* pages(items: Array<{ id: string; code: string; name: string; price: number; stock: number; minStock: number; category: string; unit: "un" | "kg" }>) {
  yield items.slice(0, 1);
  yield items.slice(1);
}

describe("offline product catalog", () => {
  beforeEach(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("mobflow-product-catalog");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Catalog database remained open between tests."));
    });
  });

  it("keeps the previous generation visible until a full replacement commits", async () => {
    const tenant = "company-a";
    const initial: OfflineCatalogProduct[] = [{ id: "1", code: "001", name: "Café", price: 10, stock: 2, minStock: 1, category: "Mercearia", unit: "un" }];
    await replaceOfflineCatalog(tenant, pages(initial));
    const broken = async function* (): AsyncGenerator<OfflineCatalogProduct[]> {
      yield initial.map((product) => ({ ...product, name: "Parcial" }));
      throw new Error("network interrupted");
    };
    await expect(replaceOfflineCatalog(tenant, broken())).rejects.toThrow("network interrupted");
    expect((await readOfflineCatalog(tenant)).products[0]?.name).toBe("Café");
  });

  it("isolates companies and stores product metadata without photo payloads", async () => {
    const product = { id: "1", code: "001", name: "Açúcar", price: 5, stock: 3, minStock: 1, category: "Mercearia", unit: "un" as const, photo: "data:image/png;base64,large" } as any;
    await replaceOfflineCatalog("company-a", pages([product]));
    expect((await readOfflineCatalog("company-a")).products[0]).not.toHaveProperty("photo");
    expect((await readOfflineCatalog("company-b")).products).toEqual([]);
  });

  it("stores and restores an 80,000-product catalog in 500-row batches", async () => {
    const total = 80_000;
    async function* largePages(): AsyncGenerator<OfflineCatalogProduct[]> {
      for (let offset = 0; offset < total; offset += 500) {
        const end = Math.min(offset + 500, total);
        const batch: OfflineCatalogProduct[] = [];
        for (let index = offset; index < end; index += 1) {
          batch.push({
            id: `product-${String(index).padStart(6, "0")}`,
            code: String(index).padStart(8, "0"),
            name: `Produto de teste ${index}`,
            price: 10 + (index % 100),
            stock: index % 50,
            minStock: 2,
            category: "Teste",
            unit: "un",
          });
        }
        yield batch;
      }
    }

    expect(await replaceOfflineCatalog("company-large", largePages())).toBe(total);
    const restored = await readOfflineCatalog("company-large");
    expect(restored.hasCatalog).toBe(true);
    expect(restored.products).toHaveLength(total);
    expect(restored.products[0]?.id).toBe("product-000000");
    expect(restored.products[total - 1]?.id).toBe(`product-${String(total - 1).padStart(6, "0")}`);
  });

  it("reports the committed catalog count without loading product rows", async () => {
    const product = { id: "1", code: "001", name: "Feijão", price: 8, stock: 4, minStock: 1, category: "Mercearia", unit: "un" as const };
    await replaceOfflineCatalog("company-a", pages([product]));
    expect(await getOfflineCatalogStatus("company-a")).toMatchObject({ count: 1, hasCatalog: true });
    expect(await getOfflineCatalogStatus("company-b")).toMatchObject({ count: 0, hasCatalog: false });
  });

  it("updates an existing product in the committed generation", async () => {
    const product = { id: "1", code: "001", name: "Arroz", price: 20, stock: 1, minStock: 1, category: "Mercearia", unit: "un" as const };
    await replaceOfflineCatalog("company-a", pages([product]));
    await upsertOfflineCatalogProduct("company-a", { ...product, stock: 7 });
    expect((await readOfflineCatalog("company-a")).products[0]?.stock).toBe(7);
  });
});
