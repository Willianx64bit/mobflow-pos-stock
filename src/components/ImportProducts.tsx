import { useState } from "react";
import * as XLSX from "xlsx";
import { actions } from "@/lib/store";

type Row = { code: string; name: string; qty: number; price?: number | undefined };

export function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Código", "Descrição", "Quantidade", "Preço (opcional)"],
    ["7891000100103", "Café 500g", 10, 18.9],
    ["7894900011517", "Refrigerante 2L", 24, ""],
  ]);
  ws["!cols"] = [{ wch: 18 }, { wch: 32 }, { wch: 12 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Produtos");
  XLSX.writeFile(wb, "modelo-importacao-mobflow.xlsx");
}

const key = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const toNum = (v: unknown) => typeof v === "number" ? v : Number(String(v ?? "").replace(/\./g, "").replace(",", ".")) ;

export function ImportProducts({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [mode, setMode] = useState<"replace" | "add">("add");
  const [done, setDone] = useState("");

  const read = async (file: File) => {
    setDone("");
    const wb = XLSX.read(await file.arrayBuffer());
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0] ?? ""]!, { defval: "" });
    const out: Row[] = [], errs: string[] = [];
    data.forEach((raw, i) => {
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) r[key(k)] = v;
      const code = String(r["codigo"] ?? r["cod"] ?? "").trim();
      const name = String(r["descricao"] ?? r["nome"] ?? r["produto"] ?? "").trim();
      const q = toNum(r["quantidade"] ?? r["qtd"]);
      const pk = Object.keys(r).find((k) => k.startsWith("preco"));
      const pr = pk && String(r[pk]).trim() !== "" ? toNum(r[pk]) : undefined;
      if (!code && !name) return undefined;
      if (!code) return errs.push(`Linha ${i + 2}: sem código`);
      if (Number.isNaN(q)) return errs.push(`Linha ${i + 2}: quantidade inválida`);
      out.push({ code, name, qty: q, price: pr !== undefined && !Number.isNaN(pr) ? pr : undefined }); return undefined;
    });
    setRows(out); setErrors(errs);
  };

  const confirm = () => {
    const r = actions.importProducts(rows, mode);
    setDone(`${r.created} produtos novos e ${r.updated} atualizados.`);
    setRows([]);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="mfb-in w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl bg-popover ring-1 ring-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl tracking-[.12em] text-heading">IMPORTAR PLANILHA</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>
        <p className="text-sm text-secondary-foreground">A planilha precisa das colunas <b>Código</b>, <b>Descrição</b> e <b>Quantidade</b>. Preço é opcional.</p>
        <button onClick={downloadTemplate} className="w-full rounded-xl bg-secondary ring-1 ring-border py-3 text-sm font-semibold text-secondary-foreground hover:bg-accent">⬇ Baixar planilha modelo</button>
        <label className="block cursor-pointer rounded-xl border border-dashed border-border px-3 py-4 text-center text-sm text-secondary-foreground hover:bg-accent">
          Escolher planilha (.xlsx, .xls, .csv)
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }} />
        </label>
        <div className="flex gap-2 text-[12px]">
          {([["replace", "Substituir estoque"], ["add", "Somar ao estoque"]] as const).map(([m, l]) => (
            <button key={m} onClick={() => setMode(m)} className={`flex-1 rounded-lg px-3 py-2 font-semibold ring-1 ${mode === m ? "bg-primary text-primary-foreground ring-primary" : "bg-secondary ring-border text-secondary-foreground"}`}>{l}</button>
          ))}
        </div>
        {errors.length > 0 && <div className="rounded-lg bg-destructive/10 p-3 font-mono text-[11px] text-destructive">{errors.slice(0, 8).map((e) => <div key={e}>{e}</div>)}</div>}
        {rows.length > 0 && (
          <>
            <div className="max-h-56 overflow-y-auto rounded-lg ring-1 ring-border divide-y divide-border/50 text-[12px]">
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[110px_1fr_60px] gap-2 px-2 py-1.5">
                  <span className="font-mono text-muted-foreground truncate">{r.code}</span>
                  <span className="text-foreground truncate">{r.name}</span>
                  <span className="font-mono text-right text-foreground">{r.qty}</span>
                </div>
              ))}
            </div>
            <button onClick={confirm} className="w-full rounded-xl bg-primary text-primary-foreground font-bold py-3 hover:bg-primary/85">Importar {rows.length} produtos</button>
          </>
        )}
        {done && <p className="rounded-lg bg-secondary p-3 text-sm text-foreground">✓ {done}</p>}
      </div>
    </div>
  );
}
