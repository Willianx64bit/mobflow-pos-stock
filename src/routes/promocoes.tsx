import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, brl, norm, useStore, type Promotion, type PromotionEvent } from "@/lib/store";
import { ChevronDown, Filter, History, Loader2, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/promocoes")({
  head: () => ({ meta: [{ title: "MobFlow — Promoções" }] }),
  component: Promotions,
});

function toLocalInput(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function fromLocalInput(value: string) {
  return new Date(value).toISOString();
}

function Promotions() {
  const navigate = useNavigate();
  const products = useStore((s) => s.products);
  const promotions = useStore((s) => s.promotions ?? []);
  const [, setClock] = useState(0);
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [promoPrice, setPromoPrice] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<PromotionEvent[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(false);
  const [historyMonth, setHistoryMonth] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyType, setHistoryType] = useState("all");
  const [historyProduct, setHistoryProduct] = useState("");
  const [promotionToDelete, setPromotionToDelete] = useState<Promotion | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("mobflow-management") !== "1") navigate({ to: "/gerencia" });
  }, [navigate]);
  useEffect(() => {
    const timer = setInterval(() => setClock((v) => v + 1), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    void actions.loadPromotions().then((events) => { if (active) { setHistory(events); setHistoryError(""); } }).catch((e) => { if (active) setHistoryError(e instanceof Error ? e.message : "Não foi possível carregar o histórico."); }).finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, []);

  const selected = products.find((p) => p.id === productId);
  const results = useMemo(() => {
    const q = norm(search.trim());
    return products.filter((p) => !q || norm(p.name).includes(q) || (p.code.includes(q) || (p.barcodes ?? []).some((code) => code.includes(q)))).slice(0, 30);
  }, [products, search]);

  const resetForm = () => {
    if (saving) return;
    setEditingId(undefined); setProductId(""); setSearch(""); setPromoPrice(""); setStartsAt(""); setEndsAt(""); setError(""); setFormOpen(false);
  };
  const edit = (promo: Promotion) => {
    setFormOpen(true);
    setEditingId(promo.id);
    setProductId(promo.productId);
    const product = products.find((p) => p.id === promo.productId);
    setSearch(product ? `${product.code} — ${product.name}` : promo.productName);
    setPromoPrice(String(promo.promoPrice));
    setStartsAt(toLocalInput(promo.startsAt));
    setEndsAt(toLocalInput(promo.endsAt));
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const save = async () => {
    if (saving) return;
    setError("");
    if (!selected) { setError("Selecione um produto da lista."); return; }
    const price = Number(promoPrice.replace(",", "."));
    if (!promoPrice.trim() || !Number.isFinite(price) || price < 0) { setError("Informe um preço promocional válido."); return; }
    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) { setError("A data e hora final devem ser posteriores ao início."); return; }
    setSaving(true);
    try {
      const ok = await actions.savePromotion({ ...(editingId ? { id: editingId } : {}), productId, promoPrice: price, startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt) });
      if (!ok) { setError("Não foi possível salvar. Confira o produto, preço e período."); return; }
      setHistory(await actions.loadPromotions());
      setHistoryError("");
      setEditingId(undefined); setProductId(""); setSearch(""); setPromoPrice(""); setStartsAt(""); setEndsAt(""); setError(""); setFormOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ocorreu um erro ao salvar a promoção. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };
  const status = (promo: Promotion) => {
    const now = Date.now();
    if (now < new Date(promo.startsAt).getTime()) return "Agendada";
    if (now <= new Date(promo.endsAt).getTime()) return "Em andamento";
    return "Encerrada";
  };
  const filteredHistory = useMemo(() => history.filter((event) => {
    const operation = String(event.payload?.operation ?? "");
    if (!["create", "update", "delete"].includes(operation)) return false;
    const created = new Date(event.created_at);
    if (!Number.isFinite(created.getTime())) return false;
    if (historyMonth && !historyFrom && !historyTo) {
      const month = String(created.getFullYear()) + "-" + String(created.getMonth() + 1).padStart(2, "0");
      if (month !== historyMonth) return false;
    }
    if (historyFrom && created < new Date(historyFrom + "T00:00:00")) return false;
    if (historyTo && created > new Date(historyTo + "T23:59:59.999")) return false;
    if (historyType !== "all" && event.payload?.operation !== historyType) return false;
    if (historyProduct) {
      const promotion = event.payload?.promotion as Record<string, unknown> | undefined;
      if (String(promotion?.productId ?? "") !== historyProduct) return false;
    }
    return true;
  }), [history, historyMonth, historyFrom, historyTo, historyType, historyProduct]);
  const formatEventDate = (value: unknown) => {
    if (typeof value !== "string" || !value) return "—";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString("pt-BR") : "—";
  };


  return (
    <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
      <AppHeader />
      <main className="mx-auto max-w-4xl space-y-5">
        <section className="rounded-2xl bg-white p-5 ring-1 ring-border md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h1 className="font-display text-2xl tracking-wide text-heading">Promoções</h1><p className="mt-1 text-sm text-muted-foreground">Defina quando o preço promocional entra e sai automaticamente no PDV.</p></div>
            <button onClick={() => navigate({ to: "/gerencia" })} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground">← Gerência</button>
          </div>
        </section>
        <section className="rounded-2xl bg-white p-5 ring-1 ring-border md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-heading">{editingId ? "Editar promoção" : formOpen ? "Cadastro de promoção" : "Promoções cadastradas"}</h2>
            {!formOpen && <button type="button" onClick={() => { resetForm(); setFormOpen(true); }} className="rounded-xl bg-primary px-4 py-2.5 font-bold text-primary-foreground">+ Nova promoção</button>}
            {formOpen && <button type="button" disabled={saving} onClick={resetForm} className="rounded-xl bg-secondary px-4 py-2.5 font-medium text-secondary-foreground disabled:cursor-wait disabled:opacity-50">Cancelar</button>}
          </div>
          {formOpen && (
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-medium text-heading">Pesquisar produto por código ou descrição</label>
              <input value={search} onChange={(e) => { setSearch(e.target.value); setProductId(""); }} placeholder="Digite código ou nome do produto" className="field mt-1 w-full text-foreground" />
              {!productId && search && <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-border bg-white">{results.map((p) => <button type="button" key={p.id} onClick={() => { setProductId(p.id); setSearch(`${p.code} — ${p.name}`); setPromoPrice(""); }} className="block w-full border-b border-border/60 px-3 py-2 text-left text-sm hover:bg-accent">{p.code} — {p.name}</button>)}</div>}
            </div>
            {selected && <div className="rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100"><div className="text-xs text-muted-foreground">Preço atual do produto</div><div className="mt-1 text-2xl font-bold text-heading">R$ {brl(selected.price)}</div><div className="text-sm text-muted-foreground">{selected.name}</div></div>}
            <div><label className="text-sm font-medium text-heading">Preço promocional (R$)</label><input value={promoPrice} onChange={(e) => setPromoPrice(e.target.value.replace(/[^0-9,.]/g, ""))} inputMode="decimal" placeholder="Ex.: 9,99" className="field mt-1 w-full text-foreground" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="text-sm font-medium text-heading">Início da promoção (dia/mês e hora)</label><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="field mt-1 w-full text-foreground" /></div>
              <div><label className="text-sm font-medium text-heading">Fim da promoção (dia/mês e hora)</label><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="field mt-1 w-full text-foreground" /></div>
            </div>
            {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
            <div className="flex gap-2"><button disabled={saving} onClick={() => { void save(); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground disabled:cursor-wait disabled:opacity-80">{saving ? <><Loader2 className="h-5 w-5 animate-spin"/>{editingId ? "Salvando alterações..." : "Criando promoção..."}</> : editingId ? "Salvar alterações" : "Criar promoção"}</button>{editingId && <button disabled={saving} onClick={resetForm} className="rounded-xl bg-secondary px-5 py-3 font-medium text-secondary-foreground disabled:cursor-wait disabled:opacity-50">Cancelar</button>}</div>
          </div>

          )}
        </section>
        {!formOpen && <section className="rounded-2xl bg-white p-5 ring-1 ring-border md:p-6">
          <h2 className="font-bold text-heading">Promoções cadastradas</h2>
          {promotions.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nenhuma promoção cadastrada.</p> : <div className="mt-3 divide-y divide-border">{[...promotions].sort((a,b) => new Date(a.startsAt).getTime()-new Date(b.startsAt).getTime()).map((promo) => {
            const product = products.find((p) => p.id === promo.productId);
            return <div key={promo.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><div className="font-semibold text-heading">{promo.productName}</div><div className="text-sm text-muted-foreground">Atual: R$ {brl(product?.price ?? promo.originalPrice)} · Promoção: R$ {brl(promo.promoPrice)}</div><div className="text-xs text-muted-foreground">{new Date(promo.startsAt).toLocaleString("pt-BR")} até {new Date(promo.endsAt).toLocaleString("pt-BR")}</div><div className="mt-1 text-xs font-semibold">{status(promo)}</div></div><button onClick={() => edit(promo)} className="rounded-lg border border-border px-3 py-2 text-sm">Editar</button><button type="button" onClick={() => setPromotionToDelete(promo)} className="rounded-lg border border-destructive/30 px-3 py-2 text-sm text-destructive">Excluir</button></div>;
          })}</div>}
        </section>}
        <section className="rounded-2xl bg-white p-5 ring-1 ring-border md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><History className="h-5 w-5" /></div><div><h2 className="font-display text-xl text-heading">Histórico de eventos</h2><p className="text-xs text-muted-foreground">Últimos 100 registros</p></div></div>
            <button type="button" onClick={() => setHistoryFiltersOpen((open) => !open)} aria-expanded={historyFiltersOpen} className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground"><Filter className="h-4 w-4" /> {historyFiltersOpen ? "Fechar filtros" : "Filtrar"} <ChevronDown className={"h-4 w-4 transition-transform " + (historyFiltersOpen ? "rotate-180" : "")} /></button>
          </div>
          {historyFiltersOpen && <div className="mt-4 grid gap-3 rounded-xl border border-border bg-background p-4 sm:grid-cols-2">
            <div><label className="mb-1 block text-xs font-semibold text-heading">Mês</label><input type="month" value={historyMonth} onChange={(e) => { setHistoryMonth(e.target.value); setHistoryFrom(""); setHistoryTo(""); }} className="field w-full text-foreground" /></div>
            <div><label className="mb-1 block text-xs font-semibold text-heading">Tipo de evento</label><select value={historyType} onChange={(e) => setHistoryType(e.target.value)} className="field w-full text-foreground"><option value="all">Todos</option><option value="create">Criou</option><option value="update">Editou</option><option value="delete">Excluiu</option></select></div>
            <div><label className="mb-1 block text-xs font-semibold text-heading">Data inicial</label><input type="date" value={historyFrom} onChange={(e) => { setHistoryFrom(e.target.value); if (e.target.value) setHistoryMonth(""); }} className="field w-full text-foreground" /></div>
            <div><label className="mb-1 block text-xs font-semibold text-heading">Data final</label><input type="date" value={historyTo} onChange={(e) => { setHistoryTo(e.target.value); if (e.target.value) setHistoryMonth(""); }} className="field w-full text-foreground" /></div>
            <div className="sm:col-span-2"><label className="mb-1 block text-xs font-semibold text-heading">Produto</label><select value={historyProduct} onChange={(e) => setHistoryProduct(e.target.value)} className="field w-full text-foreground"><option value="">Todos os produtos</option>{products.map((product) => <option key={product.id} value={product.id}>{product.code} — {product.name}</option>)}</select></div>
            <div className="sm:col-span-2"><button type="button" onClick={() => { setHistoryMonth(""); setHistoryFrom(""); setHistoryTo(""); setHistoryType("all"); setHistoryProduct(""); }} className="rounded-lg bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground">Limpar filtros</button></div>
          </div>}
          {historyLoading && <p className="mt-3 text-sm text-muted-foreground">Carregando histórico...</p>}
          {historyError && <p className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{historyError}</p>}
          {!historyLoading && !historyError && history.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Nenhum evento de promoção registrado ainda.</p>}
          {!historyLoading && !historyError && history.length > 0 && filteredHistory.length === 0 && <p className="mt-3 rounded-xl bg-secondary/50 p-4 text-sm text-muted-foreground">Nenhum evento encontrado com esses filtros.</p>}
          {!historyLoading && !historyError && filteredHistory.length > 0 && <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[620px] border-collapse text-sm"><thead className="bg-secondary/70 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-3 font-semibold">Data hora</th><th className="px-3 py-3 font-semibold">Eventos</th><th className="px-3 py-3 font-semibold">Data hora início</th><th className="px-3 py-3 font-semibold">Data hora fim</th></tr></thead>
              <tbody>{filteredHistory.map((event) => { const op = event.payload?.operation; const label = op === "create" ? "Criou" : op === "update" ? "Editou" : op === "delete" ? "Excluiu" : "Evento"; const promotion = event.payload?.promotion as Record<string, unknown> | undefined; return <tr key={event.event_id} className="border-t border-border/70"><td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatEventDate(event.created_at)}</td><td className="px-3 py-3 font-semibold text-heading">{label}</td><td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatEventDate(promotion?.startsAt)}</td><td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatEventDate(promotion?.endsAt)}</td></tr>; })}</tbody>
            </table>
          </div>}
        </section>
      </main>
      <AlertDialog open={!!promotionToDelete} onOpenChange={(open) => { if (!open && !deleting) setPromotionToDelete(null); }}>
        <AlertDialogContent className="rounded-2xl border-border">
          <AlertDialogHeader>
            <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-destructive sm:mx-0"><Trash2 className="h-6 w-6" /></div>
            <AlertDialogTitle className="font-display text-heading">Excluir promoção?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a promoção de <strong>{promotionToDelete?.productName ?? "este produto"}</strong>? Essa ação não poderá ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(event) => {
              event.preventDefault();
              if (!promotionToDelete || deleting) return;
              setDeleting(true);
              void actions.deletePromotion(promotionToDelete.id)
                .then(() => actions.loadPromotions())
                .then((events) => { setHistory(events); setHistoryError(""); setPromotionToDelete(null); })
                .catch((e) => setHistoryError(e instanceof Error ? e.message : "Falha ao excluir promoção."))
                .finally(() => setDeleting(false));
            }}>{deleting ? "Excluindo..." : "Sim, excluir"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
