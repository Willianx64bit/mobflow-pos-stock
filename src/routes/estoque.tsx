import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ProductForm } from "@/components/ProductForm";
import { ImportProducts } from "@/components/ImportProducts";
import { StockExportDialog } from "@/components/StockExportDialog";
import { actions, brl, norm, useStore, type Product } from "@/lib/store";

export const Route = createFileRoute("/estoque")({
  head: () => ({
    meta: [
      { title: "MobFlow — Estoque" },
      { name: "description", content: "Adicione e edite produtos, preços e quantidades do estoque em segundos." },
      { property: "og:title", content: "MobFlow — Estoque" },
      { property: "og:description", content: "Controle de estoque rápido com edição direta na tabela." },
    ],
  }),
  component: Estoque,
});

function Cell({ value, onSave, money, danger, weight }: { value: number; onSave: (n: number) => void; money?: boolean; danger?: boolean; weight?: boolean }) {
  const fmt = money ? brl(value) : weight ? `${brl(value)}kg` : String(value);
  const [v, setV] = useState(fmt);
  useEffect(() => setV(fmt), [fmt]);
  const commit = () => {
    const raw = weight ? v.trim().toLowerCase().replace(",", ".") : v;
    const n = weight
      ? (/^\d+(?:\.\d+)?\s*g$/.test(raw) ? Number(raw.replace(/g$/, "").trim()) / 1000 : /^\d+(?:\.\d+)?\s*kg$/.test(raw) ? Number(raw.replace(/kg$/, "").trim()) : NaN)
      : Number(raw.replace(/\./g, money ? "" : ".").replace(",", "."));
    if (!Number.isNaN(n) && n !== value) onSave(money ? n : weight ? n : Math.round(n)); else setV(fmt);
  };
  return (
    <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      onFocus={(e) => e.target.select()} inputMode="decimal"
      className={`w-full bg-transparent font-mono rounded-md px-2 py-1 outline-none hover:bg-secondary focus:bg-well focus:ring-1 focus:ring-ring ${danger ? "text-destructive" : money ? "text-subtle" : "text-foreground"}`} />
  );
}

function Estoque() {
  const navigate = useNavigate();
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [summary, setSummary] = useState({ total: 0, active: 0, inactive: 0, low: 0, value: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProducts, setExportProducts] = useState<Product[]>([]);

  const refreshStockCatalog = async () => {
    setLoading(true);
    try {
      const [page, totals] = await Promise.all([
        actions.loadStockCatalogPage(q, null, onlyLow, 50),
        actions.loadStockCatalogSummary(),
      ]);
      setCatalogProducts(page.products);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setSummary(totals);
    } finally {
      setLoading(false);
    }
  };
  const loadMoreProducts = async () => {
    if (!hasMore || !nextCursor || loading) return;
    setLoading(true);
    try {
      const page = await actions.loadStockCatalogPage(q, nextCursor, onlyLow, 50);
      setCatalogProducts((current) => [...current, ...page.products]);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sessionStorage.getItem("mobflow-management") !== "1") navigate({ to: "/gerencia" });
  }, [navigate]);

  useEffect(() => { void refreshStockCatalog().catch(() => undefined); }, [q, onlyLow]);

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        {[["Produtos", summary.total.toLocaleString("pt-BR")], ["Valor em estoque", `R$ ${brl(summary.value)}`], ["Estoque baixo", summary.low.toLocaleString("pt-BR")]].map(([l, v], i) => (
          <div key={l} className="glass p-4">
            <div className="label-mono">{l}</div>
            <div className={`font-display text-4xl mt-1 ${i === 2 && summary.low ? "text-destructive" : "text-heading"}`}>{v}</div>
          </div>
        ))}
      </div>
      <section className="glass p-4">
        <div className="flex justify-end mb-3"><button onClick={() => navigate({ to: "/gerencia" })} className="rounded-xl bg-secondary px-4 py-2 text-sm text-secondary-foreground hover:bg-accent">← Voltar para gerência</button></div>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por nome, código ou categoria…" className="field flex-1 min-w-60 text-sm text-foreground" />
          <button onClick={() => setOnlyLow(!onlyLow)}
            className={`rounded-lg px-3 py-2 text-[12px] font-semibold ring-1 ${onlyLow ? "bg-destructive/15 ring-destructive/50 text-destructive" : "bg-secondary ring-border text-secondary-foreground"}`}>
            ⚠ Só estoque baixo
          </button>
          <button onClick={() => setImporting(true)} className="rounded-lg px-3 py-2 text-[12px] font-semibold ring-1 bg-secondary ring-border text-secondary-foreground hover:bg-accent">
            ⬆ Importar planilha
          </button>
          <button onClick={async () => { const all = await actions.loadStockCatalog(); setExportProducts(all); setExporting(true); }} className="rounded-lg px-3 py-2 text-[12px] font-semibold ring-1 bg-secondary ring-border text-secondary-foreground hover:bg-accent">
            ⬇ Exportar estoque
          </button>
          <button onClick={() => setEditing(null)} className="text-[13px] font-semibold text-primary-foreground bg-primary rounded-lg px-4 py-2 hover:bg-primary/85">
            + Produto 
          </button>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[930px]">
            <div className="grid grid-cols-[34px_72px_120px_1fr_100px_100px_140px] gap-x-3 label-mono px-2 pb-3 text-[14px]">
              <span></span><span>Foto</span><span>Código</span><span>Descrição</span><span>Quantidade</span><span>Preço</span><span>Situação</span>
            </div>
            <div className="divide-y divide-border/50">
              {catalogProducts.map((p) => {
                const low = p.stock <= p.minStock;
                return (
                  <div key={p.id} className={`grid grid-cols-[34px_72px_120px_1fr_100px_100px_140px] gap-x-3 items-center py-3 px-2 text-[16px] rounded-lg ${low ? "bg-destructive/5" : ""} ${p.active === false ? "opacity-70" : ""}`}>
                    <button onClick={() => setEditing(p)} aria-label={`Editar ${p.name}`} title="Editar produto" className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-primary hover:bg-accent text-lg">
                      ✎
                    </button>
                    <div className="h-12 w-12 overflow-hidden rounded-md bg-surface ring-1 ring-border/50 grid place-items-center">
                      {p.photo ? <img src={p.photo} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                    <span className="font-mono text-[14px] text-muted-foreground truncate">{p.code}</span>
                    <span className="text-foreground truncate font-medium">{p.name}</span>
                    <span className={low ? "text-destructive font-semibold" : "text-foreground"}>
                      {p.unit === "kg" ? `${p.stock} kg` : `${p.stock} un`}
                    </span>
                    <span className="text-foreground font-medium">R$ {brl(p.price)}</span>
                    <button type="button" disabled={updatingStatusId === p.id} title={p.active === false ? "Ativar produto" : "Desativar produto"} onClick={async () => {
                      const nextActive = p.active === false;
                      setUpdatingStatusId(p.id);
                      try {
                        const updated = await actions.setProductActive(p, nextActive);
                        setCatalogProducts((current) => current.map((item) => item.id === p.id ? updated : item));
                      } catch (error) {
                        alert(error instanceof Error ? error.message : "Não foi possível alterar a situação do produto.");
                      } finally { setUpdatingStatusId(null); }
                    }} className={`rounded-lg px-2 py-1.5 text-xs font-semibold ring-1 disabled:opacity-50 ${p.active === false ? "bg-amber-50 text-amber-800 ring-amber-300 hover:bg-amber-100" : "bg-green-50 text-green-800 ring-green-300 hover:bg-green-100"}`}>
                      {updatingStatusId === p.id ? "Salvando…" : p.active === false ? "Inativo · Ativar" : "Ativo · Desativar"}
                    </button>
                  </div>
                );
              })}
              {!loading && catalogProducts.length === 0 && <p className="py-10 text-center font-mono text-[13px] text-muted-foreground">nenhum produto encontrado</p>}{loading && catalogProducts.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Carregando produtos…</p>}
            </div>
            {(hasMore || catalogProducts.length > 0) && (
              <div className="flex flex-col items-center gap-2 py-4">
                <p className="text-xs text-muted-foreground">Exibindo {catalogProducts.length.toLocaleString("pt-BR")} produtos{summary.total ? ` · ${summary.total.toLocaleString("pt-BR")} no catálogo` : ""}</p>
                {hasMore && <button type="button" disabled={loading} onClick={() => void loadMoreProducts()}
                  className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground ring-1 ring-border hover:bg-accent disabled:opacity-50">
                  {loading ? "Carregando…" : "Carregar mais 50 produtos"}
                </button>}
              </div>
            )}
          </div>
        </div>
        <p className="mt-3 font-mono text-[10px] text-muted-foreground">Use o ✎ no início do produto para editar.</p>
      </section>
      {editing !== undefined && <ProductForm product={editing} onClose={() => { setEditing(undefined); void refreshStockCatalog().catch(() => undefined); }} />}
      {importing && <ImportProducts onClose={() => { setImporting(false); void refreshStockCatalog().catch(() => undefined); }} />}
      {exporting && <StockExportDialog products={exportProducts} onClose={() => setExporting(false)} />}
    </div>
  );
}
