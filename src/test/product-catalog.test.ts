import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { readOfflineCatalog, replaceOfflineCatalog, upsertOfflineCatalogProduct, type OfflineCatalogProduct } from "@/lib/product-catalog";

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

  it("updates an existing product in the committed generation", async () => {
    const product = { id: "1", code: "001", name: "Arroz", price: 20, stock: 1, minStock: 1, category: "Mercearia", unit: "un" as const };
    await replaceOfflineCatalog("company-a", pages([product]));
    await upsertOfflineCatalogProduct("company-a", { ...product, stock: 7 });
    expect((await readOfflineCatalog("company-a")).products[0]?.stock).toBe(7);
  });
});
