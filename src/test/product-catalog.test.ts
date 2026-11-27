import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { commitOfflineCatalogSync, getOfflineCatalogStatus, getOfflineCatalogSyncState, readOfflineCatalog, readPendingOfflineCatalog, replaceOfflineCatalog, upsertOfflineCatalogProduct, writeOfflineCatalogPage, type OfflineCatalogProduct } from "@/lib/product-catalog";

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

  it("stores and restores an 100,000-product catalog in 500-row batches", async () => {
    const total = 100_000;
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

  it("resumes a staged catalog from its saved cursor and commits only when complete", async () => {
    const previous: OfflineCatalogProduct = { id: "old", code: "001", name: "Catálogo anterior", price: 5, stock: 1, minStock: 0, category: "Teste", unit: "un" };
    const first: OfflineCatalogProduct = { id: "new-1", code: "002", name: "Produto novo A", price: 7, stock: 2, minStock: 0, category: "Teste", unit: "un" };
    const second: OfflineCatalogProduct = { id: "new-2", code: "003", name: "Produto novo B", price: 9, stock: 3, minStock: 0, category: "Teste", unit: "un" };
    await replaceOfflineCatalog("company-resume", pages([previous]));

    await writeOfflineCatalogPage("company-resume", [first], "cursor-after-first");
    expect(await getOfflineCatalogSyncState("company-resume")).toMatchObject({
      pending: true,
      cursor: "cursor-after-first",
      count: 1,
      complete: false,
    });
    expect((await readOfflineCatalog("company-resume")).products.map((product) => product.id)).toEqual(["old"]);
    expect((await readPendingOfflineCatalog("company-resume")).map((product) => product.id)).toEqual(["new-1"]);

    await writeOfflineCatalogPage("company-resume", [second], null);
    expect((await getOfflineCatalogSyncState("company-resume")).complete).toBe(true);
    expect(await commitOfflineCatalogSync("company-resume")).toBe(2);
    expect((await readOfflineCatalog("company-resume")).products.map((product) => product.id)).toEqual(["new-1", "new-2"]);
    expect((await getOfflineCatalogSyncState("company-resume")).pending).toBe(false);
  });

  it("resumes an 100,000-product paged Neon sync after an interruption", async () => {
    const total = 100_000;
    const pageSize = 500;
    const makePage = (offset: number, end: number): OfflineCatalogProduct[] => {
      const batch: OfflineCatalogProduct[] = [];
      for (let index = offset; index < end; index += 1) {
        batch.push({
          id: `resume-product-${String(index).padStart(6, "0")}`,
          code: String(index).padStart(8, "0"),
          name: `Produto retomável ${index}`,
          price: 12 + (index % 90),
          stock: index % 40,
          minStock: 1,
          category: "Teste de retomada",
          unit: "un",
        });
      }
      return batch;
    };

    // Simulate the first app session: persist 50,000 rows and a durable cursor,
    // then stop before the remaining pages are downloaded.
    for (let offset = 0; offset < total / 2; offset += pageSize) {
      const end = offset + pageSize;
      await writeOfflineCatalogPage(
        "company-resume-large",
        makePage(offset, end),
        `cursor-${end}`,
      );
    }

    const checkpoint = await getOfflineCatalogSyncState("company-resume-large");
    expect(checkpoint).toMatchObject({
      pending: true,
      cursor: "cursor-50000",
      count: 50_000,
      complete: false,
    });
    expect(await readPendingOfflineCatalog("company-resume-large")).toHaveLength(50_000);
    expect((await readOfflineCatalog("company-resume-large")).hasCatalog).toBe(false);

    // Simulate a fresh app session resuming from the saved cursor.
    for (let offset = total / 2; offset < total; offset += pageSize) {
      const end = offset + pageSize;
      await writeOfflineCatalogPage(
        "company-resume-large",
        makePage(offset, end),
        end < total ? `cursor-${end}` : null,
      );
    }

    expect(await getOfflineCatalogSyncState("company-resume-large")).toMatchObject({
      pending: true,
      cursor: null,
      count: total,
      complete: true,
    });
    expect(await commitOfflineCatalogSync("company-resume-large")).toBe(total);
    const restored = await readOfflineCatalog("company-resume-large");
    expect(restored.hasCatalog).toBe(true);
    expect(restored.products).toHaveLength(total);
    expect(restored.products[0]?.id).toBe("resume-product-000000");
    expect(restored.products[total - 1]?.id).toBe("resume-product-099999");
    expect((await getOfflineCatalogSyncState("company-resume-large")).pending).toBe(false);
  }, 15_000);

  it("updates an existing product in the committed generation", async () => {
    const product = { id: "1", code: "001", name: "Arroz", price: 20, stock: 1, minStock: 1, category: "Mercearia", unit: "un" as const };
    await replaceOfflineCatalog("company-a", pages([product]));
    await upsertOfflineCatalogProduct("company-a", { ...product, stock: 7 });
    expect((await readOfflineCatalog("company-a")).products[0]?.stock).toBe(7);
  });
});
