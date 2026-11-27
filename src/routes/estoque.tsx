import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Eye, Loader2, X } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { ProductForm } from "@/components/ProductForm";
import { ImportProducts } from "@/components/ImportProducts";
import { StockExportDialog } from "@/components/StockExportDialog";
import { actions, brl, type Product, type StockCatalogSummary, type StockProductDetails } from "@/lib/store";

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

function Estoque() {
  const navigate = useNavigate();
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [summary, setSummary] = useState<StockCatalogSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [category, setCategory] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("all");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "zero" | "positive">("all");
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const requestSequence = useRef(0);
  const detailsRequestSequence = useRef(0);
  const summaryLoaded = useRef(false);
  const editRequestSequence = useRef(0);
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [exportProducts, setExportProducts] = useState<Product[] | null>(null);
  const [loadingExport, setLoadingExport] = useState(false);
  const [detailsFor, setDetailsFor] = useState<Product | null>(null);
  const [details, setDetails] = useState<StockProductDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  useEffect(() => {
    if (sessionStorage.getItem("mobflow-management") !== "1") navigate({ to: "/gerencia" });
  }, [navigate]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    setCursorHistory([null]);
  }, [debouncedQ, category, activeFilter, stockFilter]);

  const cursor = cursorHistory[cursorHistory.length - 1] ?? null;
  useEffect(() => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError("");
    actions.loadStockCatalogPage({
      q: debouncedQ,
      category,
      active: activeFilter,
      stock: stockFilter,
      cursor,
      includeSummary: !summaryLoaded.current,
    }).then((page) => {
      if (page.summary) { setSummary(page.summary); summaryLoaded.current = true; }
      if (requestId !== requestSequence.current) return;
      setCatalogProducts(page.products);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    }).catch((reason) => {
      if (requestId !== requestSequence.current) return;
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar o inventário.");
      setCatalogProducts([]);
      setHasMore(false);
      setNextCursor(null);
    }).finally(() => {
      if (requestId === requestSequence.current) setLoading(false);
    });
    return () => { requestSequence.current += 1; };
  }, [debouncedQ, category, activeFilter, stockFilter, cursor, reloadKey]);

  const refreshStockCatalog = () => { summaryLoaded.current = false; setSummary(null); setCursorHistory([null]); setReloadKey((value) => value + 1); };
  const openExport = async () => {
    setLoadingExport(true);
    setError("");
    try {
      // Export is an explicit action: fetch the complete catalog only when the
      // user opens the export dialog, never while browsing the 100-row pages.
      const allProducts = await actions.loadStockCatalog();
      setExportProducts(allProducts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível preparar a exportação.");
    } finally {
      setLoadingExport(false);
    }
  };
  const openEdit = async (product: Product) => {
    const requestId = ++editRequestSequence.current;
    setLoadingEditId(product.id);
    try {
      // The paged inventory list intentionally omits cost. Fetch it only when
      // opening the editor so ProductForm never defaults an existing cost to zero.
      const cost = await actions.loadStockProductCost(product.id);
      if (requestId === editRequestSequence.current) setEditing({ ...product, cost });
    } catch (reason) {
      if (requestId === editRequestSequence.current) alert(reason instanceof Error ? reason.message : "Não foi possível carregar o custo do produto.");
    } finally {
      if (requestId === editRequestSequence.current) setLoadingEditId(null);
    }
  };
  const openDetails = async (product: Product) => {
    const requestId = ++detailsRequestSequence.current;
    setDetailsFor(product);
    setDetails(null);
    setDetailsError("");
    setDetailsLoading(true);
    try {
      const result = await actions.loadStockProductDetails(product.id);
      if (requestId === detailsRequestSequence.current) setDetails(result);
    } catch (reason) {
      if (requestId === detailsRequestSequence.current) setDetailsError(reason instanceof Error ? reason.message : "Não foi possível consultar os detalhes.");
    } finally {
      if (requestId === detailsRequestSequence.current) setDetailsLoading(false);
    }
  };
  const closeDetails = () => {
    detailsRequestSequence.current += 1;
    setDetailsFor(null);
    setDetailsLoading(false);
  };

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        {[
          ["Produtos", String(summary?.total ?? "—")],
          ["Valor em estoque", summary ? `R$ ${brl(summary.inventoryValue)}` : "—"],
          ["Estoque baixo", String(summary?.lowStock ?? "—")],
        ].map(([label, value], index) => (
          <div key={label} className="glass p-4">
            <div className="label-mono">{label}</div>
            <div className={`font-display text-4xl mt-1 ${index === 2 && (summary?.lowStock ?? 0) > 0 ? "text-destructive" : "text-heading"}`}>{value}</div>
            {index === 0 && summary && <p className="mt-1 text-xs text-muted-foreground">{summary.active} ativos · {summary.inactive} inativos</p>}
          </div>
        ))}
      </div>
      <section className="glass p-4">
        <div className="flex justify-end mb-3">
          <button onClick={() => navigate({ to: "/gerencia" })} className="rounded-xl bg-secondary px-4 py-2 text-sm text-secondary-foreground hover:bg-accent">← Voltar para gerência</button>
        </div>
        <div className="grid gap-3 mb-4 xl:grid-cols-[minmax(220px,1.4fr)_minmax(150px,1fr)_minmax(150px,1fr)_minmax(140px,.8fr)]">
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Nome, código, barras ou categoria…" className="field min-w-0 text-sm text-foreground" />
          <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Filtrar categoria…" className="field min-w-0 text-sm text-foreground" />
          <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as typeof activeFilter)} className="field min-w-0 text-sm text-foreground">
            <option value="all">Todos os produtos</option>
            <option value="active">Somente ativos</option>
            <option value="inactive">Somente inativos</option>
          </select>
          <select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as typeof stockFilter)} className="field min-w-0 text-sm text-foreground">
            <option value="all">Todos os estoques</option>
            <option value="low">Estoque baixo</option>
            <option value="zero">Sem estoque</option>
            <option value="positive">Com estoque</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 mb-4">
          <button onClick={() => setImporting(true)} className="rounded-lg px-3 py-2 text-[12px] font-semibold ring-1 bg-secondary ring-border text-secondary-foreground hover:bg-accent">⬆ Importar planilha</button>
          <button onClick={() => void openExport()} disabled={loadingExport} className="rounded-lg px-3 py-2 text-[12px] font-semibold ring-1 bg-secondary ring-border text-secondary-foreground hover:bg-accent disabled:opacity-50">
            {loadingExport ? "Preparando…" : "⬇ Exportar estoque"}
          </button>
          <button onClick={() => setEditing(null)} className="text-[13px] font-semibold text-primary-foreground bg-primary rounded-lg px-4 py-2 hover:bg-primary/85">+ Produto</button>
        </div>
        {error && <p role="alert" className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="overflow-x-auto">
          <div className="min-w-[980px]">
            <div className="grid grid-cols-[34px_34px_72px_120px_1fr_100px_100px_140px] gap-x-3 label-mono px-2 pb-3 text-[14px]">
              <span></span><span></span><span>Foto</span><span>Código</span><span>Descrição</span><span>Quantidade</span><span>Preço</span><span>Situação</span>
            </div>
            <div className="divide-y divide-border/50">
              {catalogProducts.map((product) => {
                const low = product.stock <= product.minStock;
                return (
                  <div key={product.id} className={`grid grid-cols-[34px_34px_72px_120px_1fr_100px_100px_140px] gap-x-3 items-center py-3 px-2 text-[16px] rounded-lg ${low ? "bg-destructive/5" : ""} ${product.active === false ? "opacity-70" : ""}`}>
                    <button onClick={() => void openEdit(product)} disabled={loadingEditId === product.id} aria-label={`Editar ${product.name}`} title="Editar produto" className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-primary hover:bg-accent text-lg disabled:opacity-40">{loadingEditId === product.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "✎"}</button>
                    <button onClick={() => void openDetails(product)} aria-label={`Ver custo e vendas de ${product.name}`} title="Ver custo e totais de vendas" className="h-7 w-7 rounded-md grid place-items-center text-muted-foreground hover:text-primary hover:bg-accent">
                      <Eye className="h-4 w-4" />
                    </button>
                    <div className="h-12 w-12 overflow-hidden rounded-md bg-surface ring-1 ring-border/50 grid place-items-center">
                      {product.photo ? <img src={product.photo} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                    <span className="font-mono text-[14px] text-muted-foreground truncate">{product.code}</span>
                    <span className="text-foreground truncate font-medium">{product.name}</span>
                    <span className={low ? "text-destructive font-semibold" : "text-foreground"}>
                      {product.unit === "kg" ? `${product.stock} kg` : `${product.stock} un`}
                    </span>
                    <span className="text-foreground font-medium">R$ {brl(product.price)}</span>
                    <button type="button" disabled={updatingStatusId === product.id} title={product.active === false ? "Ativar produto" : "Desativar produto"} onClick={async () => {
                      const nextActive = product.active === false;
                      setUpdatingStatusId(product.id);
                      try {
                        await actions.setProductActive(product, nextActive);
                        refreshStockCatalog();
                      } catch (reason) {
                        alert(reason instanceof Error ? reason.message : "Não foi possível alterar a situação do produto.");
                      } finally { setUpdatingStatusId(null); }
                    }} className={`rounded-lg px-2 py-1.5 text-xs font-semibold ring-1 disabled:opacity-50 ${product.active === false ? "bg-amber-50 text-amber-800 ring-amber-300 hover:bg-amber-100" : "bg-green-50 text-green-800 ring-green-300 hover:bg-green-100"}`}>
                      {updatingStatusId === product.id ? "Salvando…" : product.active === false ? "Inativo · Ativar" : "Ativo · Desativar"}
                    </button>
                  </div>
                );
              })}
              {loading && <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Consultando até 100 produtos no Neon…</div>}
              {!loading && !catalogProducts.length && <p className="py-10 text-center font-mono text-[13px] text-muted-foreground">nenhum produto encontrado</p>}
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-xs text-muted-foreground">Página {cursorHistory.length} · {catalogProducts.length} produtos exibidos por página · {summary?.total ?? 0} no catálogo</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setCursorHistory((history) => history.length > 1 ? history.slice(0, -1) : history)} disabled={loading || cursorHistory.length <= 1} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-accent disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />Anterior
            </button>
            <button type="button" onClick={() => { if (nextCursor && hasMore) setCursorHistory((history) => [...history, nextCursor]); }} disabled={loading || !hasMore || !nextCursor} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-accent disabled:opacity-40">
              Próxima<ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <p className="mt-3 font-mono text-[10px] text-muted-foreground">Use o ✎ para editar. O ícone de olho consulta custo e vendas somente quando solicitado.</p>
      </section>
      {editing !== undefined && <ProductForm product={editing} onClose={() => { editRequestSequence.current += 1; setLoadingEditId(null); setEditing(undefined); refreshStockCatalog(); }} /> }
      {importing && <ImportProducts onClose={() => { setImporting(false); refreshStockCatalog(); }} />}
      {exportProducts && <StockExportDialog products={exportProducts} onClose={() => setExportProducts(null)} />}
      {detailsFor && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/75 backdrop-blur-sm p-3" onClick={closeDetails}>
          <section role="dialog" aria-modal="true" aria-labelledby="product-details-title" onClick={(event) => event.stopPropagation()} className="mfb-in w-full max-w-xl rounded-2xl bg-popover p-5 shadow-2xl ring-1 ring-border">
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="product-details-title" className="font-display text-xl text-heading">CUSTO E VENDAS</h2>
                <p className="mt-1 truncate text-sm text-muted-foreground">{detailsFor.name} · {detailsFor.code}</p>
              </div>
              <button type="button" onClick={closeDetails} aria-label="Fechar detalhes" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
            </header>
            {detailsLoading && <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Consultando dados no Neon…</div>}
            {detailsError && <p role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{detailsError}</p>}
            {details && (
              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  ["Custo unitário", `R$ ${brl(details.cost)}`],
                  ["Unidades vendidas", String(details.unitsSold)],
                  ["Vendas", String(details.salesCount)],
                  ["Faturamento", `R$ ${brl(details.revenue)}`],
                  ["Custo vendido", `R$ ${brl(details.costTotal)}`],
                  ["Lucro bruto", `R$ ${brl(details.grossProfit)}`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-border bg-background/50 p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-4 text-[11px] text-muted-foreground">Totais calculados no Neon considerando somente vendas concluídas.</p>
          </section>
        </div>
      )}
    </div>
  );
}
