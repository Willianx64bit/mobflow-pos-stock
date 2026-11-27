import type { Product } from "@/lib/store";

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function buildProductBarcodeIndex(products: Product[], supplemental: Product[] = []): Map<string, Product> {
  const index = new Map<string, Product>();
  // Neon is authoritative when an online supplement returns a newer record.
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

export type LocalProductSearchIndex = { products: Product[]; searchText: string[] };

const normalizedProductTextCache = new WeakMap<Product, string>();
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

export function buildLocalProductSearchIndex(products: Product[]): LocalProductSearchIndex {
  return {
    products,
    // Product objects unaffected by stock/price events retain their cached
    // normalized text, avoiding 100k repeated normalizations after each delta.
    searchText: products.map(normalizedProductSearchText),
  };
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
