import { useState } from "react";
import * as XLSX from "xlsx";
import { actions, useStore, type Product } from "@/lib/store";

type Row = { code: string; name: string; qty: 0 };

export function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([["Código de barras", "Descrição"]]);
  ws["!cols"] = [{ wch: 22 }, { wch: 42 }];
  ws["!ref"] = "A1:B1000";
  for (let row = 2; row <= 1000; row++) {
    ws[`A${row}`] = { t: "s", v: "", z: "@" };
    ws[`B${row}`] = { t: "s", v: "" };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Produtos");
  XLSX.writeFile(wb, "modelo-importacao-mobflow.xlsx");
}

const key = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const headerValue = (row: Record<string, unknown>, aliases: string[]) => {
  const found = Object.entries(row).find(([name]) => aliases.includes(key(name)));
  return found?.[1] ?? "";
};
const barcodeText = (value: unknown) => {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? String(value) : "";
  const text = String(value ?? "").trim().replace(/[.,]0+$/, "");
  return text.replace(/\D/g, "");
};
const worksheetRows = (sheet: XLSX.WorkSheet) => {
  if (!sheet["!ref"]) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const headers = Array.from({ length: range.e.c - range.s.c + 1 }, (_, offset) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c + offset })];
    return String(cell?.v ?? "").trim();
  });
  const rows: Record<string, unknown>[] = [];
  for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex++) {
    const row: Record<string, unknown> = {};
    headers.forEach((header, offset) => {
      if (!header) return;
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: range.s.c + offset })];
      let value: unknown = cell?.v ?? "";
      if (typeof value === "number" && /^(c[oó]digo|ean|gtin|barcode)/i.test(key(header)) && typeof cell?.z === "string" && /^0+$/.test(cell.z)) {
        value = XLSX.SSF.format(cell.z, value);
      }
      row[header] = value;
    });
    rows.push(row);
  }
  return rows;
};

export function parseImportRows(data: Record<string, unknown>[]) {
  const rows: Row[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  data.forEach((raw, index) => {
    const code = barcodeText(headerValue(raw, ["código de barras", "codigo de barras", "código", "codigo", "cod", "ean", "gtin", "barcode"]));
    const name = String(headerValue(raw, ["descrição", "descricao", "nome", "produto"]) ?? "").trim();
    if (!code && !name) return;
    if (!code) { errors.push(`Linha ${index + 2}: código de barras ausente ou inválido.`); return; }
    if (!name) { errors.push(`Linha ${index + 2}: descrição ausente.`); return; }
    if (seen.has(code)) { errors.push(`Linha ${index + 2}: código ${code} repetido na planilha.`); return; }
    seen.add(code);
    rows.push({ code, name, qty: 0 });
  });
  return { rows, errors };
}

export function ImportProducts({ onClose }: { onClose: () => void }) {
  const products = useStore((s) => s.products);
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  const read = async (file: File) => {
    setDone("");
    setErrors([]);
    setRows([]);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellText: true, cellNF: true });
      const sheet = wb.Sheets[wb.SheetNames[0] ?? ""];
      if (!sheet) throw new Error("A planilha não contém uma aba para importar.");
      // Read raw cell values so numeric barcodes never gain decimal separators;
      // custom zero masks are reapplied below to preserve leading zeroes.
      const data = worksheetRows(sheet);
      const parsed = parseImportRows(data);
      setRows(parsed.rows);
      setErrors(parsed.errors);
      if (!parsed.rows.length && !parsed.errors.length) setErrors(["A planilha está vazia ou não contém as colunas Código de barras e Descrição."]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Não foi possível ler a planilha. Use o modelo disponibilizado nesta tela."]);
    }
  };

  const confirm = async () => {
    if (!rows.length || busy) return;
    setBusy(true);
    setDone("");
    const failures: string[] = [];
    let created = 0, updated = 0;
    const neonCatalog = import.meta.env["VITE_MOBFLOW_CATALOG_READ_PROVIDER"] === "neon";
    try {
      if (!neonCatalog) {
        const result = actions.importProducts(rows, "add");
        created = result.created;
        updated = result.updated;
      } else {
        const byCode = new Map<string, Product>();
        for (const product of products) {
          byCode.set(product.code, product);
          for (const barcode of product.barcodes ?? []) byCode.set(barcode, product);
        }
        const submitBatch = async (chunk: Row[], offset: number): Promise<void> => {
          const items = chunk.map((row) => {
            const existing = byCode.get(row.code);
            return {
              id: existing?.id ?? crypto.randomUUID(),
              ...(existing?.version ? { expectedVersion: existing.version } : {}),
              code: row.code,
              name: row.name,
            };
          });
          try {
            const response = await fetch("/api/mobflow/products", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items }),
            });
            const result = await response.json().catch(() => null);
            if (!response.ok || result?.ok !== true || !Array.isArray(result?.products) || result.products.length !== chunk.length) {
              if ((response.status === 400 || response.status === 409) && chunk.length > 1) {
                const middle = Math.ceil(chunk.length / 2);
                await submitBatch(chunk.slice(0, middle), offset);
                await submitBatch(chunk.slice(middle), offset + middle);
                return;
              }
              throw new Error(result?.error || "O servidor não confirmou este lote.");
            }
            actions.applyCatalogProducts(result.products as Product[]);
            created += Number(result.created ?? 0);
            updated += Number(result.updated ?? 0);
          } catch (error) {
            const message = error instanceof Error ? error.message : "falha ao gravar o lote";
            for (let index = 0; index < chunk.length; index++) {
              const row = chunk[index]!;
              failures.push("Linha " + (offset + index + 2) + " (" + row.code + "): " + message);
            }
          }
        };
        for (let offset = 0; offset < rows.length; offset += 100) {
          await submitBatch(rows.slice(offset, offset + 100), offset);
        }
      }
      setDone(`${created} produto(s) novo(s) e ${updated} atualizado(s). Os produtos novos entraram com estoque zero.`);
      setRows([]);
      if (failures.length) setErrors((current) => [...current, ...failures]);
    } catch (error) {
      setErrors((current) => [...current, error instanceof Error ? error.message : "Não foi possível concluir a importação."]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="mfb-in w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl bg-popover ring-1 ring-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl tracking-[.12em] text-heading">IMPORTAR PLANILHA</h2>
          <button onClick={onClose} disabled={busy} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <p className="text-sm text-secondary-foreground">Use somente as colunas <b>Código de barras</b> e <b>Descrição</b>. O código é lido como texto e todo produto novo entra com estoque zero. O preço pode ser cadastrado depois.</p>
        <button onClick={downloadTemplate} disabled={busy} className="w-full rounded-xl bg-secondary ring-1 ring-border py-3 text-sm font-semibold text-secondary-foreground hover:bg-accent">⬇ Baixar planilha modelo</button>
        <label className="block cursor-pointer rounded-xl border border-dashed border-border px-3 py-4 text-center text-sm text-secondary-foreground hover:bg-accent">
          Escolher planilha (.xlsx, .xls, .csv)
          <input type="file" accept=".xlsx,.xls,.csv" disabled={busy} className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void read(file); e.target.value = ""; }} />
        </label>
        {errors.length > 0 && <div className="rounded-lg bg-destructive/10 p-3 font-mono text-[11px] text-destructive">{errors.slice(0, 10).map((error, index) => <div key={index}>{error}</div>)}</div>}
        {rows.length > 0 && (
          <>
            <div className="max-h-56 overflow-y-auto rounded-lg ring-1 ring-border divide-y divide-border/50 text-[12px]">
              {rows.map((row, index) => (
                <div key={index} className="grid grid-cols-[130px_1fr] gap-2 px-2 py-2">
                  <span className="font-mono text-muted-foreground truncate">{row.code}</span>
                  <span className="text-foreground truncate">{row.name}</span>
                </div>
              ))}
            </div>
            <button onClick={() => void confirm()} disabled={busy} className="w-full rounded-xl bg-primary text-primary-foreground font-bold py-3 hover:bg-primary/85 disabled:opacity-60">{busy ? "Importando produtos..." : `Importar ${rows.length} produtos`}</button>
          </>
        )}
        {done && <p className="rounded-lg bg-secondary p-3 text-sm text-foreground">✓ {done}</p>}
      </div>
    </div>
  );
}
