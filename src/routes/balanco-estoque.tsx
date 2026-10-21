import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, useStore, type Product } from "@/lib/store";
import { ArrowLeft, CheckCircle2, ClipboardList, PackagePlus, Search, Scale, Trash2 } from "lucide-react";

type DraftItem = { productId: string; mode: "somar" | "definir"; quantity: string };

export const Route = createFileRoute("/balanco-estoque")({
  head: () => ({ meta: [
    { title: "MobFlow — Balanço de estoque" },
    { name: "description", content: "Ajuste vários produtos e consulte o histórico de balanços." },
  ] }),
  component: BalancoEstoque,
});

function BalancoEstoque() {
  const navigate = useNavigate();
  const products = useStore((s) => s.products);
  const history = useStore((s) => s.stockAdjustments ?? []);
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("mobflow-management") !== "1") navigate({ to: "/gerencia" });
  }, [navigate]);

  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return [];
    return products.filter((p) =>
      p.code.toLocaleLowerCase().includes(q) ||
      p.name.toLocaleLowerCase().includes(q) ||
      (p.ref ?? "").toLocaleLowerCase().includes(q)
    ).slice(0, 8);
  }, [products, query]);

  const addProduct = (product: Product) => {
    if (drafts.some((d) => d.productId === product.id)) {
      setError("Esse produto já está na lista de ajustes.");
      return;
    }
    setDrafts((old) => [...old, { productId: product.id, mode: "somar", quantity: "" }]);
    setQuery("");
    setError("");
    setMessage("");
  };

  const updateDraft = (productId: string, patch: Partial<DraftItem>) => {
    setDrafts((old) => old.map((d) => d.productId === productId ? { ...d, ...patch } : d));
    setError("");
    setMessage("");
  };

  const saveBatch = () => {
    if (saving) return;
    if (!reason.trim()) { setError("O motivo do ajuste é obrigatório."); return; }
    if (!drafts.length) { setError("Adicione pelo menos um produto ao balanço."); return; }
    const payload: { productId: string; mode: "somar" | "definir"; quantity: number }[] = [];
    for (const draft of drafts) {
      if (!draft.quantity.trim()) { setError("Informe a quantidade ou o novo saldo de todos os produtos."); return; }
      const value = Number(draft.quantity.trim().replace(",", "."));
      const product = products.find((p) => p.id === draft.productId);
      if (!product || !Number.isFinite(value) || value < 0) { setError("Confira as quantidades informadas."); return; }
      if (product.unit !== "kg" && !Number.isInteger(value)) { setError(`A quantidade de "${product.name}" precisa ser um número inteiro.`); return; }
      payload.push({ productId: draft.productId, mode: draft.mode, quantity: value });
    }
    setSaving(true);
    setError("");
    const result = actions.applyStockAdjustmentBatch({ reason: reason.trim(), items: payload });
    setSaving(false);
    if (!result) { setError("Não foi possível registrar o balanço. Confira os produtos e tente novamente."); return; }
    setMessage(`Balanço registrado com sucesso: ${drafts.length} produto(s) ajustado(s).`);
    setDrafts([]);
    setReason("");
    setQuery("");
  };

  const fmtDate = (date: string) => {
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleString("pt-BR");
  };

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl space-y-5">
        <section className="glass p-5 md:p-6">
          <button type="button" onClick={() => navigate({ to: "/gerencia" })} className="mb-5 inline-flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground hover:bg-accent">
            <ArrowLeft className="h-4 w-4" /> Voltar para Gerência
          </button>
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Scale className="h-6 w-6" /></div>
            <div>
              <h1 className="font-display text-2xl tracking-wide text-heading md:text-3xl">BALANÇO DE ESTOQUE</h1>
              <p className="mt-1 text-sm text-muted-foreground">Adicione vários produtos, informe o motivo e registre todas as alterações.</p>
            </div>
          </div>

          <div className="mt-6">
            <label htmlFor="stock-product-search" className="mb-2 block text-sm font-semibold text-heading">Adicionar produto</label>
            <div className="relative flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input id="stock-product-search" value={query}
                  onChange={(e) => { setQuery(e.target.value); setError(""); }}
                  placeholder="Código de barras, nome ou REF"
                  autoComplete="off"
                  className="field w-full pl-10 text-foreground" />
              </div>
            </div>
            {results.length > 0 && (
              <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background">
                {results.map((p) => (
                  <button key={p.id} type="button" onClick={() => addProduct(p)} className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-3 text-left last:border-b-0 hover:bg-secondary/70">
                    {p.photo ? <img src={p.photo} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <div className="grid h-10 w-10 place-items-center rounded-lg bg-secondary"><PackagePlus className="h-5 w-5 text-muted-foreground" /></div>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-foreground">{p.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">Código: {p.code}{p.ref ? ` · REF: ${p.ref}` : ""}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-foreground">Saldo: {p.stock} {p.unit === "kg" ? "kg" : "un."}</span>
                    <span className="text-primary text-sm font-bold">+ Adicionar</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-heading">Produtos deste balanço</h2>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">{drafts.length} produto(s)</span>
            </div>
            {drafts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Pesquise um produto acima e toque nele para adicioná-lo. Você pode incluir vários antes de salvar.</div>
            ) : (
              <div className="space-y-3">
                {drafts.map((draft) => {
                  const product = products.find((p) => p.id === draft.productId);
                  if (!product) return null;
                  const value = draft.quantity.trim() ? Number(draft.quantity.replace(",", ".")) : NaN;
                  const next = Number.isFinite(value) && value >= 0 ? (draft.mode === "somar" ? product.stock + value : value) : null;
                  return (
                    <div key={draft.productId} className="rounded-xl border border-border bg-background p-4">
                      <div className="flex items-start gap-3">
                        {product.photo ? <img src={product.photo} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-secondary"><PackagePlus className="h-5 w-5 text-muted-foreground" /></div>}
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-heading">{product.name}</div>
                          <div className="mt-1 break-all font-mono text-xs text-muted-foreground">Código: {product.code} · REF: {product.ref || "—"}</div>
                          <div className="mt-1 text-sm text-muted-foreground">Saldo atual: <strong className="text-heading">{product.stock} {product.unit === "kg" ? "kg" : "un."}</strong></div>
                        </div>
                        <button type="button" onClick={() => setDrafts((old) => old.filter((d) => d.productId !== product.id))} aria-label={`Remover ${product.name}`} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-xs font-semibold text-heading">Operação</label>
                          <select value={draft.mode} onChange={(e) => updateDraft(product.id, { mode: e.target.value as "somar" | "definir" })} className="field w-full text-foreground">
                            <option value="somar">Somar ao saldo atual</option>
                            <option value="definir">Definir novo saldo total</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-2 block text-xs font-semibold text-heading">{draft.mode === "somar" ? "Quantidade para somar" : "Novo saldo total"}</label>
                          <input type="number" min="0" step={product.unit === "kg" ? "0.001" : "1"} inputMode="decimal" value={draft.quantity}
                            onChange={(e) => updateDraft(product.id, { quantity: e.target.value })}
                            placeholder={product.unit === "kg" ? "Ex.: 2,500" : "Ex.: 12"} className="field w-full font-mono text-foreground" />
                        </div>
                      </div>
                      {next !== null && <div className="mt-3 rounded-lg bg-primary/5 px-3 py-2 text-sm text-muted-foreground">Saldo após ajuste: <strong className="text-heading">{next} {product.unit === "kg" ? "kg" : "un."}</strong></div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-6">
            <label htmlFor="stock-adjust-reason" className="mb-2 block text-sm font-semibold text-heading">Motivo do ajuste <span className="text-destructive">*</span></label>
            <textarea id="stock-adjust-reason" value={reason} onChange={(e) => { setReason(e.target.value); setError(""); }}
              placeholder="Ex.: contagem física, perda, avaria, correção de cadastro..." rows={3} required
              className="field w-full resize-y text-foreground" />
            <p className="mt-1 text-xs text-muted-foreground">Obrigatório. Este motivo ficará salvo no histórico junto com os produtos e os saldos anteriores e novos.</p>
          </div>

          {error && <div role="alert" className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          {message && <div role="status" className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{message}</div>}
          <button type="button" onClick={saveBatch} disabled={saving || drafts.length === 0} className="mt-5 w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground disabled:opacity-50">
            {saving ? "Registrando balanço..." : `Confirmar balanço de ${drafts.length} produto(s)`}
          </button>
        </section>

        <section className="glass p-5 md:p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><ClipboardList className="h-5 w-5" /></div>
            <div>
              <h2 className="font-display text-xl text-heading">HISTÓRICO DE AJUSTES</h2>
              <p className="text-sm text-muted-foreground">Registros salvos com data, operador, motivo e saldos alterados.</p>
            </div>
          </div>
          {history.length === 0 ? (
            <p className="mt-4 rounded-xl bg-secondary/50 p-4 text-sm text-muted-foreground">Nenhum balanço registrado ainda.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {history.map((entry) => (
                <details key={entry.id} className="rounded-xl border border-border bg-background p-4">
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-heading">{entry.reason}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{fmtDate(entry.date)}{entry.operator ? ` · Operador: ${entry.operator}` : ""}</div>
                      </div>
                      <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">{entry.items.length} produto(s)</span>
                    </div>
                  </summary>
                  <div className="mt-4 space-y-2 border-t border-border pt-3">
                    {entry.items.map((item) => (
                      <div key={item.productId} className="rounded-lg bg-secondary/40 p-3">
                        <div className="font-semibold text-foreground">{item.name}</div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">Código: {item.code} · REF: {item.ref || "—"}</div>
                        <div className="mt-2 text-sm text-muted-foreground">{item.mode === "somar" ? `Somou ${item.quantity}` : `Definiu saldo para ${item.quantity}`} · {item.previousStock} → <strong className="text-heading">{item.newStock} {item.unit === "kg" ? "kg" : "un."}</strong></div>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
