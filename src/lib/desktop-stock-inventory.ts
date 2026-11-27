import type { Product, StockCatalogFilters, StockCatalogPage, StockCatalogSummary } from "@/lib/store";

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

/** Paginate the EXE's already-synchronized local catalog when the deployed web host
 * does not yet expose the newer inventory-only Neon endpoint. */
export function buildDesktopStockCatalogPage(products: Product[], filters: StockCatalogFilters = {}): StockCatalogPage {
  const summary: StockCatalogSummary = {
    total: products.length,
    active: products.filter((product) => product.active !== false).length,
    inactive: products.filter((product) => product.active === false).length,
    lowStock: products.filter((product) => product.active !== false && product.stock <= product.minStock).length,
    inventoryValue: products.reduce((sum, product) => sum + product.stock * product.price, 0),
  };
  const query = normalize(filters.q?.trim() ?? "");
  const category = normalize(filters.category?.trim() ?? "");
  const filtered = products.filter((product) => {
    if (filters.active === "active" && product.active === false) return false;
    if (filters.active === "inactive" && product.active !== false) return false;
    if (filters.stock === "low" && !(product.stock > 0 && product.stock <= product.minStock)) return false;
    if (filters.stock === "zero" && product.stock > 0) return false;
    if (filters.stock === "positive" && product.stock <= 0) return false;
    if (category && !normalize(product.category ?? "").includes(category)) return false;
    if (query) {
      const searchable = normalize([product.name, product.code, product.category, ...(product.barcodes ?? [])].join(" "));
      if (!searchable.includes(query)) return false;
    }
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id));
  const cursorIndex = filters.cursor ? filtered.findIndex((product) => product.id === filters.cursor) : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const page = filtered.slice(start, start + 100);
  const hasMore = start + page.length < filtered.length;
  return {
    products: page,
    hasMore,
    nextCursor: hasMore && page.length ? page[page.length - 1]!.id : null,
    summary: filters.includeSummary === false ? null : summary,
  };
}
