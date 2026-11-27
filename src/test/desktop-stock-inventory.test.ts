import { describe, expect, it } from "vitest";
import { buildDesktopStockCatalogPage } from "@/lib/desktop-stock-inventory";
import type { Product } from "@/lib/store";

const product = (id: string, name: string, stock: number, active = true): Product => ({
  id, name, code: id, price: 10, cost: 5, stock, minStock: 2, category: "Mercearia", unit: "un", active,
});

describe("EXE local inventory fallback", () => {
  const products = [
    product("1", "Arroz", 8),
    product("2", "Açúcar", 1),
    product("3", "Feijão", 0),
    product("4", "Arroz integral", 4, false),
  ];

  it("filters, searches without accents and calculates the full catalog summary", () => {
    const page = buildDesktopStockCatalogPage(products, { q: "acucar", includeSummary: true });
    expect(page.products.map((item) => item.id)).toEqual(["2"]);
    expect(page.summary).toEqual({ total: 4, active: 3, inactive: 1, lowStock: 2, inventoryValue: 130 });
  });

  it("paginates deterministically without losing products", () => {
    const many = Array.from({ length: 245 }, (_, index) => product(String(index).padStart(3, "0"), `Produto ${String(index).padStart(3, "0")}`, 5));
    const first = buildDesktopStockCatalogPage(many);
    const second = buildDesktopStockCatalogPage(many, { cursor: first.nextCursor });
    const third = buildDesktopStockCatalogPage(many, { cursor: second.nextCursor });
    expect(first.products).toHaveLength(100);
    expect(second.products).toHaveLength(100);
    expect(third.products).toHaveLength(45);
    expect(new Set([...first.products, ...second.products, ...third.products].map((item) => item.id)).size).toBe(245);
    expect(third.hasMore).toBe(false);
  });

  it("applies active and stock filters", () => {
    expect(buildDesktopStockCatalogPage(products, { active: "inactive" }).products.map((item) => item.id)).toEqual(["4"]);
    expect(buildDesktopStockCatalogPage(products, { stock: "zero" }).products.map((item) => item.id)).toEqual(["3"]);
    expect(buildDesktopStockCatalogPage(products, { stock: "low" }).products.map((item) => item.id)).toEqual(["2"]);
  });
});
