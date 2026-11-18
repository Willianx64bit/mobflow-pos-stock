import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import type { Product } from "@/lib/store";

type ExportField = "alternateCode" | "ref" | "barcode" | "description" | "quantity" | "cost" | "price";
type QuantityMode = "any" | "greater" | "less" | "equal" | "negative";

const allFields: ExportField[] = ["alternateCode", "ref", "barcode", "description", "quantity", "cost", "price"];
const fieldLabels: Record<ExportField, string> = {
  alternateCode: "Código alternativo",
  ref: "REF",
  barcode: "Código de barras",
  description: "Descrição",
  quantity: "Quantidade",
  cost: "Preço custo",
  price: "Preço venda",
};

export function buildStockExportRows(products: Product[], selected: ExportField[]) {
  const columns = selected.map((field) => fieldLabels[field]);
  const rows = products.map((product) => selected.map((field) => {
    switch (field) {
      case "alternateCode": return (product.barcodes ?? []).join(", ");
      case "ref": return product.ref ?? "";
      case "barcode": return product.code ?? "";
      case "description": return product.name;
      case "quantity": return product.stock;
      case "cost": return product.cost ?? 0;
      case "price": return product.price;
    }
  }));
  return { columns, rows };
}

export function StockExportDialog({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const [selectedFields, setSelectedFields] = useState<ExportField[]>(["barcode", "description", "quantity"]);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [quantityMode, setQuantityMode] = useState<QuantityMode>("any");
  const [quantityValue, setQuantityValue] = useState("0");

  const hasSearch = search.trim().length > 0;
  const filteredProducts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const target = Number(quantityValue);
    if (!term) return [];
    return products.filter((product) => {
      const matchesSearch = [product.name, product.code, product.ref ?? "", ...(product.barcodes ?? [])]
        .some((value) => String(value).toLocaleLowerCase("pt-BR").includes(term));
      if (!matchesSearch) return false;
      switch (quantityMode) {
        case "greater": return Number.isFinite(target) && product.stock > target;
        case "less": return Number.isFinite(target) && product.stock < target;
        case "equal": return Number.isFinite(target) && product.stock === target;
        case "negative": return product.stock < 0;
        default: return true;
      }
    });
  }, [products, search, quantityMode, quantityValue]);

  const allFieldsSelected = selectedFields.length === allFields.length;
  const allVisibleProductsSelected = filteredProducts.length > 0 && filteredProducts.every((product) => selectedProducts.includes(product.id));
  const exportProducts = products.filter((product) => selectedProducts.includes(product.id));

  const toggleField = (field: ExportField) => setSelectedFields((current) =>
    current.includes(field) ? current.filter((item) => item !== field) : [...current, field]
  );
  const toggleVisibleProducts = () => setSelectedProducts((current) => {
    if (allVisibleProductsSelected) {
      const visibleIds = new Set(filteredProducts.map((product) => product.id));
      return current.filter((id) => !visibleIds.has(id));
    }
    return Array.from(new Set([...current, ...filteredProducts.map((product) => product.id)]));
  });

  const download = () => {
    if (!selectedFields.length || !exportProducts.length) return;
    const { columns, rows } = buildStockExportRows(exportProducts, selectedFields);
    const sheet = XLSX.utils.aoa_to_sheet([columns, ...rows]);
    sheet["!cols"] = columns.map((column) => ({ wch: Math.max(16, column.length + 3) }));
    selectedFields.forEach((field, columnIndex) => {
      if (field === "barcode" || field === "alternateCode" || field === "ref") {
        for (let rowIndex = 2; rowIndex <= rows.length + 1; rowIndex++) {
          const address = XLSX.utils.encode_cell({ r: rowIndex - 1, c: columnIndex });
          const cell = sheet[address];
          if (cell) { cell.t = "s"; cell.z = "@"; cell.v = String(cell.v ?? ""); }
        }
      }
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Estoque");
    XLSX.writeFile(workbook, "mobflow-exportacao-estoque.xlsx");
    onClose();
  };

  const checkClass = "flex min-h-11 items-center gap-3 rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-sm text-foreground hover:bg-accent cursor-pointer";
  const inputClass = "field min-w-0 w-full text-sm text-foreground";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/75 backdrop-blur-sm p-3 md:p-6" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="stock-export-title" onClick={(event) => event.stopPropagation()} className="mfb-in flex w-full max-w-6xl max-h-[94vh] flex-col overflow-hidden rounded-2xl bg-popover ring-1 ring-border shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4 md:px-7">
          <div>
            <h2 id="stock-export-title" className="font-display text-xl md:text-2xl tracking-[.1em] text-heading">EXPORTAR ESTOQUE</h2>
            <p className="mt-1 text-sm text-muted-foreground">Configure as colunas e escolha exatamente quais produtos deseja baixar.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent text-xl">✕</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-7">
          <div className="grid gap-7 xl:grid-cols-[minmax(280px,.8fr)_minmax(0,1.5fr)]">
            <section className="space-y-3">
              <h3 className="font-semibold text-foreground">Colunas da planilha</h3>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <label className={checkClass}>
                  <input type="checkbox" checked={allFieldsSelected} onChange={() => setSelectedFields(allFieldsSelected ? [] : allFields)} className="h-4 w-4 accent-primary" />
                  <span className="font-bold">Selecionar todos</span>
                </label>
                {allFields.map((field) => (
                  <label key={field} className={checkClass}>
                    <input type="checkbox" checked={selectedFields.includes(field)} onChange={() => toggleField(field)} className="h-4 w-4 accent-primary" />
                    <span>{fieldLabels[field]}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{selectedFields.length} de {allFields.length} colunas selecionadas. Os três tipos de código ficam disponíveis na mesma lista.</p>
            </section>

            <section className="min-w-0 space-y-4">
              <h3 className="font-semibold text-foreground">Produtos para exportar</h3>

              <div className="grid gap-3 rounded-xl border border-border bg-background/40 p-4 md:grid-cols-[minmax(180px,1fr)_190px_130px]">
                <div className="relative z-20 min-w-0">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-muted-foreground">Buscar produto</span>
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, código ou REF..." className={inputClass} />
                  </label>
                  {hasSearch && (
                    <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border bg-background/70 px-3 py-2 text-sm font-semibold text-foreground hover:bg-accent">
                        <input type="checkbox" checked={allVisibleProductsSelected} onChange={toggleVisibleProducts} disabled={!filteredProducts.length} className="h-4 w-4 accent-primary" />
                        Selecionar todos os produtos encontrados
                      </label>
                      <div className="max-h-[320px] overflow-y-auto">
                        {filteredProducts.length ? filteredProducts.map((product) => (
                          <label key={product.id} className="flex min-h-14 cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 last:border-0 hover:bg-accent/60">
                            <input type="checkbox" checked={selectedProducts.includes(product.id)} onChange={() => setSelectedProducts((current) =>
                              current.includes(product.id) ? current.filter((id) => id !== product.id) : [...current, product.id]
                            )} className="h-4 w-4 shrink-0 accent-primary" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">{product.name}</span>
                              <span className="block truncate font-mono text-xs text-muted-foreground">{product.code || "Sem código"}</span>
                            </span>
                            <span className={`shrink-0 text-sm font-semibold tabular-nums ${product.stock < 0 ? "text-destructive" : "text-foreground"}`}>
                              {product.stock} {product.unit === "kg" ? "kg" : "un"}
                            </span>
                          </label>
                        )) : <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhum produto encontrado com esses filtros.</p>}
                      </div>
                    </div>
                  )}
                </div>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">Quantidade</span>
                  <select value={quantityMode} onChange={(event) => setQuantityMode(event.target.value as QuantityMode)} className={inputClass}>
                    <option value="any">Todas as quantidades</option>
                    <option value="greater">Maior que</option>
                    <option value="less">Menor que</option>
                    <option value="equal">Igual a</option>
                    <option value="negative">Negativa (abaixo de zero)</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">Número desejado</span>
                  <input type="number" value={quantityValue} onChange={(event) => setQuantityValue(event.target.value)} disabled={quantityMode === "any" || quantityMode === "negative"} className={inputClass} />
                </label>
              </div>
            </section>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background/60 px-5 py-4 md:px-7">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-3 text-sm font-semibold text-foreground hover:bg-accent">Cancelar</button>
            <button type="button" onClick={download} disabled={!selectedFields.length || !exportProducts.length} className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/85 disabled:opacity-50">Baixar planilha</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
