import type { Product } from "@/lib/store";

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function buildProductBarcodeIndex(products: Product[], supplemental: Product[] = []): Map<string, Product> {
  const index = new Map<string, Product>();
  for (const product of products) {
    const code = product.code.trim();
    if (code) index.set(code, product);
    for (const barcode of product.barcodes ?? []) {
      const value = barcode.trim();
      if (value) index.set(value, product);
    }
  }
  // Local catalog entries always win over supplemental server results.
  for (const product of supplemental) {
    const code = product.code.trim();
    if (code && !index.has(code)) index.set(code, product);
    for (const barcode of product.barcodes ?? []) {
      const value = barcode.trim();
      if (value && !index.has(value)) index.set(value, product);
    }
  }
  return index;
}

export function searchLocalProducts(products: Product[], query: string, limit = 100): Product[] {
  const max = Math.max(1, Math.min(100, Math.floor(limit)));
  const term = normalizeSearchText(query.trim());
  if (!term) return products.slice(0, max);
  return products.filter((product) =>
    normalizeSearchText(product.name).includes(term) ||
    product.code.includes(term) ||
    (product.barcodes ?? []).some((barcode) => barcode.includes(term)) ||
    normalizeSearchText(product.category).includes(term)
  ).slice(0, max);
}
