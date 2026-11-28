import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { OfflineProductSearchEngine, type OfflineSearchDocument } from "@/lib/offline-search-engine";

const tenant = "offline-search-automation";
const makeProducts = (total: number): OfflineSearchDocument[] =>
  Array.from({ length: total }, (_, index) => ({
    id: `product-${String(index).padStart(6, "0")}`,
    name: index % 2 === 0 ? `Arroz tipo ${index}` : `Produto ${index}`,
    code: String(index).padStart(8, "0"),
    barcodes: [`789000${String(index).padStart(7, "0")}`],
    category: index % 3 === 0 ? "Mercearia" : "Higiene",
  }));

async function deleteDatabase(name: string) {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Banco de teste ainda está em uso."));
  });
}

describe("persistent offline FlexSearch", () => {
  beforeEach(async () => {
    await deleteDatabase("mobflow-product-search-v1-" + encodeURIComponent(tenant).replace(/%/g, "_").slice(0, 120));
    await deleteDatabase("mobflow-offline-search-meta");
  });

  it("indexes 50k products, searches partial terms and restores the index after a new engine starts", async () => {
    const products = makeProducts(50_000);
    const first = new OfflineProductSearchEngine();
    const initialized = await first.initialize(tenant, products);
    expect(initialized).toMatchObject({ ready: true, rebuilt: true, count: 50_000 });
    expect(await first.search("arr", 100)).toHaveLength(100);
    expect(await first.search("7890000000042", 5)).toContain("product-000042");

    const second = new OfflineProductSearchEngine();
    const restored = await second.initialize(tenant, products);
    expect(restored).toMatchObject({ ready: true, rebuilt: false, count: 50_000 });
    expect(await second.search("arroz tipo 42", 10)).toContain("product-000042");
  }, 120_000);

  it("updates and removes only changed product documents without rebuilding the full index", async () => {
    const products = makeProducts(300);
    const engine = new OfflineProductSearchEngine();
    await engine.initialize(tenant, products);
    const previous = products[0]!;
    const renamed = { ...previous, name: "Café especial" };
    await engine.applyDelta([{ previous, next: renamed }, { previous: products[1]! }]);
    expect(await engine.search("cafe", 10)).toContain(previous.id);
    expect(await engine.search("arroz", 100)).not.toContain(products[1]!.id);

    const reopened = new OfflineProductSearchEngine();
    const afterRestart = await reopened.initialize(tenant, [renamed, ...products.slice(2)]);
    expect(afterRestart.rebuilt).toBe(false);
    expect(await reopened.search("cafe", 10)).toContain(previous.id);
  });
});
