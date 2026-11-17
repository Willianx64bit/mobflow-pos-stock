import { useState } from "react";
import * as XLSX from "xlsx";
import type { Product } from "@/lib/store";

type ExportField = "alternateCode" | "ref" | "barcode" | "description" | "quantity" | "cost" | "price";

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
  const [codesOpen, setCodesOpen] = useState(false);
  const [selected, setSelected] = useState<ExportField[]>(["barcode", "description", "quantity"]);
  const toggle = (field: ExportField) => setSelected((current) =>
    current.includes(field) ? current.filter((item) => item !== field) : [...current, field]
  );

  const download = () => {
    if (!selected.length) return;
    const { columns, rows } = buildStockExportRows(products, selected);
    const sheet = XLSX.utils.aoa_to_sheet([columns, ...rows]);
    sheet["!cols"] = columns.map((column) => ({ wch: Math.max(16, column.length + 3) }));
    selected.forEach((field, columnIndex) => {
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

  const check = (field: ExportField) => (
    <label key={field} className="flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-accent cursor-pointer">
      <input type="checkbox" checked={selected.includes(field)} onChange={() => toggle(field)} className="h-4 w-4 accent-primary" />
      {fieldLabels[field]}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="stock-export-title" onClick={(event) => event.stopPropagation()} className="mfb-in w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-popover p-5 ring-1 ring-border shadow-xl space-y-4">
        <header className="flex items-center justify-between gap-3">
          <h2 id="stock-export-title" className="font-display text-xl tracking-[.1em] text-heading">EXPORTAR ESTOQUE</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent">✕</button>
        </header>
        <p className="text-sm text-muted-foreground">Escolha quais informações deseja incluir na planilha. Você pode selecionar várias opções.</p>
        <div className="rounded-xl border border-border p-2 space-y-1">
          <button type="button" onClick={() => setCodesOpen((open) => !open)} aria-expanded={codesOpen} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-foreground hover:bg-accent">
            <span>Códigos</span><span className="text-muted-foreground">{codesOpen ? "−" : "+"}</span>
          </button>
          {codesOpen && <div className="border-t border-border pt-1">{check("alternateCode")}{check("ref")}{check("barcode")}</div>}
        </div>
        <div className="rounded-xl border border-border p-2 space-y-1">
          {check("description")}
          {check("quantity")}
          {check("cost")}
          {check("price")}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{selected.length} coluna(s) selecionada(s) · {products.length} produto(s)</span>
          <button type="button" onClick={download} disabled={!selected.length || !products.length} className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/85 disabled:opacity-50">Baixar planilha</button>
        </div>
      </section>
    </div>
  );
}
