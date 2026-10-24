import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, brl, norm, useStore, type Promotion } from "@/lib/store";
import { Loader2 } from "lucide-react";

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

  useEffect(() => {
    if (sessionStorage.getItem("mobflow-management") !== "1") navigate({ to: "/gerencia" });
  }, [navigate]);
  useEffect(() => {
    const timer = setInterval(() => setClock((v) => v + 1), 15000);
    return () => clearInterval(timer);
  }, []);

  const selected = products.find((p) => p.id === productId);
  const results = useMemo(() => {
    const q = norm(search.trim());
    return products.filter((p) => !q || norm(p.name).includes(q) || (p.code.includes(q) || (p.barcodes ?? []).some((code) => code.includes(q)))).slice(0, 30);
  }, [products, search]);

  const resetForm = () => {
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
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    const ok = actions.savePromotion({ id: editingId, productId, promoPrice: price, startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt) });
    setSaving(false);
    if (!ok) { setError("Não foi possível salvar. Confira o produto, preço e período."); return; }
    resetForm();
  };
  const status = (promo: Promotion) => {
    const now = Date.now();
    if (now < new Date(promo.startsAt).getTime()) return "Agendada";
    if (now <= new Date(promo.endsAt).getTime()) return "Em andamento";
    return "Encerrada";
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
            {formOpen && <button type="button" onClick={resetForm} className="rounded-xl bg-secondary px-4 py-2.5 font-medium text-secondary-foreground">Cancelar</button>}
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
            <div className="flex gap-2"><button disabled={saving} onClick={() => { void save(); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground disabled:cursor-wait disabled:opacity-80">{saving ? <><Loader2 className="h-5 w-5 animate-spin"/>{editingId ? "Salvando alterações..." : "Criando promoção..."}</> : editingId ? "Salvar alterações" : "Criar promoção"}</button>{editingId && <button onClick={resetForm} className="rounded-xl bg-secondary px-5 py-3 font-medium text-secondary-foreground">Cancelar</button>}</div>
          </div>

          )}
        </section>
        {!formOpen && <section className="rounded-2xl bg-white p-5 ring-1 ring-border md:p-6">
          <h2 className="font-bold text-heading">Promoções cadastradas</h2>
          {promotions.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nenhuma promoção cadastrada.</p> : <div className="mt-3 divide-y divide-border">{[...promotions].sort((a,b) => new Date(a.startsAt).getTime()-new Date(b.startsAt).getTime()).map((promo) => {
            const product = products.find((p) => p.id === promo.productId);
            return <div key={promo.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><div className="font-semibold text-heading">{promo.productName}</div><div className="text-sm text-muted-foreground">Atual: R$ {brl(product?.price ?? promo.originalPrice)} · Promoção: R$ {brl(promo.promoPrice)}</div><div className="text-xs text-muted-foreground">{new Date(promo.startsAt).toLocaleString("pt-BR")} até {new Date(promo.endsAt).toLocaleString("pt-BR")}</div><div className="mt-1 text-xs font-semibold">{status(promo)}</div></div><button onClick={() => edit(promo)} className="rounded-lg border border-border px-3 py-2 text-sm">Editar</button><button onClick={() => { if (window.confirm("Excluir esta promoção?")) actions.deletePromotion(promo.id); }} className="rounded-lg border border-destructive/30 px-3 py-2 text-sm text-destructive">Excluir</button></div>;
          })}</div>}
        </section>}
      </main>
    </div>
  );
}
