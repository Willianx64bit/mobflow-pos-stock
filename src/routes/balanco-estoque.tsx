import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, useStore, type Product } from "@/lib/store";
import { ArrowLeft, CheckCircle2, PackagePlus, Search, Scale } from "lucide-react";

export const Route = createFileRoute("/balanco-estoque")({
  head: () => ({
    meta: [
      { title: "MobFlow — Balanço de estoque" },
      { name: "description", content: "Some quantidades ou defina o saldo atual dos produtos." },
    ],
  }),
  component: BalancoEstoque,
});

function BalancoEstoque() {
  const navigate = useNavigate();
  const products = useStore((s) => s.products);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [mode, setMode] = useState<"somar" | "definir">("somar");
  const [quantity, setQuantity] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("mobflow-management") !== "1") navigate({ to: "/gerencia" });
  }, [navigate]);

  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q || selected) return [];
    return products.filter((p) =>
      p.code.toLocaleLowerCase().includes(q) ||
      p.name.toLocaleLowerCase().includes(q) ||
      (p.ref ?? "").toLocaleLowerCase().includes(q)
    ).slice(0, 8);
  }, [products, query, selected]);

  const chooseProduct = (product: Product) => {
    setSelected(product);
    setQuery(product.code);
    setQuantity("");
    setMessage("");
    setError("");
  };

  const findProduct = () => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) {
      setError("Digite o código de barras, nome ou REF do produto.");
      return;
    }
    const exact = products.find((p) =>
      p.code.toLocaleLowerCase() === q ||
      (p.ref ?? "").toLocaleLowerCase() === q
    );
    const match = exact ?? products.find((p) =>
      p.name.toLocaleLowerCase() === q ||
      p.code.toLocaleLowerCase().includes(q) ||
      p.name.toLocaleLowerCase().includes(q) ||
      (p.ref ?? "").toLocaleLowerCase().includes(q)
    );
    if (!match) {
      setSelected(null);
      setError("Nenhum produto encontrado. Confira o código, nome ou REF.");
      return;
    }
    chooseProduct(match);
  };

  const saveAdjustment = () => {
    if (saving || !selected) return;
    const parsed = Number(quantity.trim().replace(",", "."));
    if (!quantity.trim() || !Number.isFinite(parsed) || parsed < 0) {
      setError("Informe uma quantidade válida, igual ou maior que zero.");
      return;
    }
    if (selected.unit !== "kg" && !Number.isInteger(parsed)) {
      setError("Para este produto, informe uma quantidade inteira.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    const normalized = selected.unit === "kg" ? Math.round(parsed * 1000) / 1000 : parsed;
    const nextStock = mode === "somar" ? selected.stock + normalized : normalized;
    actions.updateField(selected.id, "stock", nextStock);
    setMessage(mode === "somar"
      ? `Adicionado ao estoque. Saldo atualizado: ${nextStock} ${selected.unit === "kg" ? "kg" : "un."}.`
      : `Saldo definido com sucesso: ${nextStock} ${selected.unit === "kg" ? "kg" : "un."}.`);
    setSelected({ ...selected, stock: nextStock });
    setQuantity("");
    setSaving(false);
  };

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl space-y-5">
        <section className="glass p-5 md:p-6">
          <button type="button" onClick={() => navigate({ to: "/gerencia" })} className="mb-5 inline-flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground hover:bg-accent">
            <ArrowLeft className="h-4 w-4" /> Voltar para Gerência
          </button>
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Scale className="h-6 w-6" /></div>
            <div>
              <h1 className="font-display text-2xl tracking-wide text-heading md:text-3xl">BALANÇO DE ESTOQUE</h1>
              <p className="mt-1 text-sm text-muted-foreground">Ajuste a quantidade de um produto sem precisar editar o cadastro.</p>
            </div>
          </div>

          <div className="mt-6">
            <label htmlFor="stock-product-search" className="mb-2 block text-sm font-semibold text-heading">Localizar produto</label>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="stock-product-search"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setSelected(null); setError(""); setMessage(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); findProduct(); } }}
                  placeholder="Código de barras, nome ou REF"
                  autoComplete="off"
                  className="field w-full pl-10 text-foreground"
                />
              </div>
              <button type="button" onClick={findProduct} className="rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground">Buscar</button>
            </div>
            {results.length > 0 && (
              <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background">
                {results.map((p) => (
                  <button key={p.id} type="button" onClick={() => chooseProduct(p)} className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-3 text-left last:border-b-0 hover:bg-secondary/70">
                    {p.photo ? <img src={p.photo} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <div className="grid h-10 w-10 place-items-center rounded-lg bg-secondary"><PackagePlus className="h-5 w-5 text-muted-foreground" /></div>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-foreground">{p.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">Código: {p.code}{p.ref ? ` · REF: ${p.ref}` : ""}</span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-foreground">{p.stock} {p.unit === "kg" ? "kg" : "un."}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <div className="mt-5 rounded-2xl border border-border bg-background p-4 md:p-5">
              <div className="flex items-start gap-3">
                {selected.photo ? <img src={selected.photo} alt="" className="h-16 w-16 rounded-xl object-cover" /> : <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-secondary"><PackagePlus className="h-7 w-7 text-muted-foreground" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-lg text-heading">{selected.name}</div>
                  <div className="mt-1 break-all font-mono text-xs text-muted-foreground">Código de barras: {selected.code}</div>
                  <div className="font-mono text-xs text-muted-foreground">REF: {selected.ref || "Não cadastrada"}</div>
                  <div className="mt-2 text-sm text-muted-foreground">Saldo atual</div>
                  <div className="text-2xl font-bold text-heading">{selected.stock} {selected.unit === "kg" ? "kg" : "un."}</div>
                </div>
                <button type="button" onClick={() => { setSelected(null); setQuery(""); setQuantity(""); setMessage(""); setError(""); }} className="text-sm font-semibold text-primary">Trocar</button>
              </div>

              <div className="mt-5">
                <div className="mb-2 text-sm font-semibold text-heading">Como deseja ajustar o estoque?</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" onClick={() => { setMode("somar"); setMessage(""); }} className={`rounded-xl border p-4 text-left transition ${mode === "somar" ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-secondary/40 hover:bg-secondary"}`}>
                    <div className="font-bold text-heading">＋ Somar ao saldo</div>
                    <div className="mt-1 text-sm text-muted-foreground">Acrescenta a quantidade informada ao estoque atual.</div>
                  </button>
                  <button type="button" onClick={() => { setMode("definir"); setMessage(""); }} className={`rounded-xl border p-4 text-left transition ${mode === "definir" ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-secondary/40 hover:bg-secondary"}`}>
                    <div className="font-bold text-heading">＝ Definir saldo</div>
                    <div className="mt-1 text-sm text-muted-foreground">Substitui o saldo atual pelo valor informado.</div>
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <label htmlFor="stock-adjust-quantity" className="mb-2 block text-sm font-semibold text-heading">{mode === "somar" ? "Quantidade para somar" : "Novo saldo total"}</label>
                <input
                  id="stock-adjust-quantity"
                  type="number"
                  min="0"
                  step={selected.unit === "kg" ? "0.001" : "1"}
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => { setQuantity(e.target.value); setError(""); setMessage(""); }}
                  placeholder={selected.unit === "kg" ? "Ex.: 2,500" : "Ex.: 12"}
                  className="field w-full text-lg font-mono text-foreground"
                />
                {quantity.trim() && Number.isFinite(Number(quantity.replace(",", "."))) && Number(quantity.replace(",", ".")) >= 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Saldo após ajuste: <strong className="text-heading">{mode === "somar" ? selected.stock + Number(quantity.replace(",", ".")) : Number(quantity.replace(",", "."))} {selected.unit === "kg" ? "kg" : "un."}</strong>
                  </p>
                )}
              </div>
              {error && <div role="alert" className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
              {message && <div role="status" className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{message}</div>}
              <button type="button" onClick={saveAdjustment} disabled={saving || !quantity.trim()} className="mt-5 w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground disabled:opacity-50">
                {saving ? "Salvando..." : mode === "somar" ? "Somar ao estoque" : "Confirmar novo saldo"}
              </button>
            </div>
          )}
          {!selected && products.length === 0 && <p className="mt-5 rounded-xl bg-secondary/60 p-4 text-sm text-muted-foreground">Ainda não há produtos cadastrados no estoque.</p>}
          {!selected && products.length > 0 && <p className="mt-4 text-xs text-muted-foreground">Digite pelo menos parte do código, nome ou REF. Se aparecer mais de um produto, selecione o correto na lista.</p>}
          {error && !selected && <div role="alert" className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        </section>
      </main>
    </div>
  );
}
