import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, useStore, type ReceivingNote } from "@/lib/store";
import { Filter, History, Search, Loader2 } from "lucide-react";

export const Route = createFileRoute("/recebimento")({
  head: () => ({ meta: [{ title: "MobFlow — Recebimento" }, { name: "description", content: "Cadastro e aprovação de notas recebidas." }] }),
  component: Recebimento,
});

function Recebimento() {
  const products = useStore((s) => s.products);
  const notes = useStore((s) => s.receiving ?? []);
  const suppliers = useStore((s) => s.suppliers ?? []);
  const contacts = useStore((s) => s.contacts ?? []);
  const navigate = useNavigate();
  useEffect(() => {
    if (sessionStorage.getItem("mobflow-management") !== "1") navigate({ to: "/gerencia" });
  }, [navigate]);
  const search = useSearch({ from: "/recebimento" }) as { nota?: string };
  const [number, setNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [supplierCnpj, setSupplierCnpj] = useState("");
  const [showNewNote, setShowNewNote] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [transitioningTo, setTransitioningTo] = useState<2 | 3 | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [showSupplierSuggestions, setShowSupplierSuggestions] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [filterNumber, setFilterNumber] = useState("");
  const [filterSupplier, setFilterSupplier] = useState("");
  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [drafts, setDrafts] = useState<{ productId: string; quantity: string }[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selected = notes.find(n => n.id === search.nota);

  const formatCnpj = (value: string) => {
    const d = value.replace(/\D/g, "").slice(0, 14);
    return d.replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  };
  const supplierSuggestions = useMemo(() => {
    const term = supplier.trim().toLowerCase();
    const saved = contacts.filter(c => c.type === "Fornecedor" && (!term || [c.name, c.document, c.phone].some(v => (v ?? "").toLowerCase().includes(term) || (v ?? "").replace(/\D/g, "").includes(term.replace(/\D/g, ""))))).map(c => ({ name: c.name, cnpj: c.document || "", id: c.id }));
    const legacy = suppliers.filter(s => !term || s.name.toLowerCase().includes(term) || (s.cnpj ?? "").replace(/\D/g, "").includes(term.replace(/\D/g, ""))).map(s => ({ name: s.name, cnpj: s.cnpj || "", id: s.name }));
    return [...saved, ...legacy.filter(s => !saved.some(c => c.name.toLowerCase() === s.name.toLowerCase()))].slice(0, 8);
  }, [contacts, suppliers, supplier]);

  const filteredNotes = useMemo(() => {
    const numberTerm = filterNumber.trim().toLowerCase();
    const supplierTerm = filterSupplier.trim().toLowerCase();
    return notes.filter(n => {
      const noteDate = (n.date || "").slice(0, 10);
      if (filterStart && (!noteDate || noteDate < filterStart)) return false;
      if (filterEnd && (!noteDate || noteDate > filterEnd)) return false;
      if (numberTerm && !String(n.number).toLowerCase().includes(numberTerm)) return false;
      const supplierDigits = supplierTerm.replace(/\D/g, "");
      const matchesSupplierName = !supplierTerm || n.supplier.toLowerCase().includes(supplierTerm);
      const matchesSupplierCnpj = !supplierDigits || (n.supplierCnpj ?? "").replace(/\D/g, "").includes(supplierDigits);
      return matchesSupplierName || matchesSupplierCnpj;
    });
  }, [notes, filterStart, filterEnd, filterNumber, filterSupplier]);

  const productSuggestions = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    return products.filter(p => !term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term) || (p.barcodes ?? []).some(code => code.toLowerCase().includes(term)) || (p.ref ?? "").toLowerCase().includes(term)).slice(0, 8);
  }, [products, productSearch]);

  const addProduct = (id: string) => {
    setDrafts(old => old.some(d => d.productId === id) ? old : [...old, { productId: id, quantity: "" }]);
    setProductSearch("");
    setProductId("");
    setError("");
  };
  const updateQuantity = (id: string, quantity: string) => {
    setDrafts(old => old.map(d => d.productId === id ? { ...d, quantity: quantity.replace(/[^0-9,.]/g, "") } : d));
    setError("");
  };
  const advanceStep = async (next: 2 | 3) => {
    if (transitioningTo !== null || savingNote) return;
    setTransitioningTo(next);
    setError("");
    setMessage("");
    await new Promise(resolve => window.setTimeout(resolve, 2000));
    setStep(next);
    setTransitioningTo(null);
  };
  const goBack = () => { setStep(step === 3 ? 2 : 1); setError(""); setMessage(""); };
  const resetForm = () => {
    setNumber(""); setSupplier(""); setSupplierCnpj(""); setProductId(""); setProductSearch("");
    setDrafts([]); setStep(1); setShowNewNote(false); setShowSupplierSuggestions(false);
    setError(""); setMessage(""); setSavingNote(false); setTransitioningTo(null);
  };
  const productTotals = drafts.map(d => {
    const p = products.find(x => x.id === d.productId);
    const quantity = Number(d.quantity.replace(",", ".")) || 0;
    const unitCost = p?.cost ?? 0;
    return { draft: d, product: p, quantity, unitCost, total: unitCost * quantity };
  });
  const subtotal = productTotals.reduce((sum, item) => sum + item.total, 0);

  const save = async () => {
    if (savingNote) return;
    if (!number.trim() || !/^\d+$/.test(number.trim())) { setError("Informe o número da nota usando somente números."); setStep(1); return; }
    if (!supplier.trim()) { setError("Selecione ou informe o fornecedor."); setStep(1); return; }
    if (!drafts.length) { setError("Adicione pelo menos um produto."); setStep(2); return; }
    for (const item of productTotals) {
      if (!item.product || !item.draft.quantity.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0 || (item.product.unit !== "kg" && !Number.isInteger(item.quantity))) {
        setError("Confira as quantidades. Elas devem ser maiores que zero e produtos por unidade não aceitam decimais.");
        setStep(2);
        return;
      }
    }
    setSavingNote(true);
    setError("");
    setMessage("");
    await new Promise(resolve => window.setTimeout(resolve, 2000));
    try {
      actions.createReceiving(number.trim(), supplier.trim(), supplierCnpj || undefined, drafts.map(d => ({ productId: d.productId, expected: Number(d.quantity.replace(",", ".")) })));
      resetForm();
    } catch {
      setError("Não foi possível salvar a nota. Confira os dados e tente novamente.");
    } finally {
      setSavingNote(false);
    }
  };

  if (selected) return <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader /><ReceivingDetail note={selected} onBack={() => navigate({ to: "/recebimento" })} /></div>;

  return <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader />
    <section className="glass p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="font-display text-2xl tracking-[.12em] text-heading">RECEBIMENTO</div>
        <div className="flex items-center gap-2">
          {!showNewNote && <button type="button" onClick={() => { resetForm(); setShowNewNote(true); }} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">+ Nova nota</button>}
          {showNewNote && <button type="button" onClick={resetForm} className="rounded-xl bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground">Fechar</button>}
          <button onClick={() => navigate({ to: "/gerencia" })} className="rounded-xl bg-secondary px-4 py-2 text-sm text-secondary-foreground hover:bg-accent">← Voltar para gerência</button>
        </div>
      </div>

      {showNewNote && <div className="space-y-4">
        <div className="flex flex-wrap justify-center gap-2 text-sm font-semibold">
          <span className={`rounded-full px-4 py-2 ${step === 1 ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>1. Fornecedor</span>
          <span className={`rounded-full px-4 py-2 ${step === 2 ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>2. Produtos</span>
          <span className={`rounded-full px-4 py-2 ${step === 3 ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>3. Confirmação</span>
        </div>

        {step === 1 && <div className="space-y-4">
          <div className="relative">
            <label className="mb-2 block text-sm font-semibold">Fornecedor</label>
            <input value={supplier} onFocus={() => setShowSupplierSuggestions(true)} onChange={e => { setSupplier(e.target.value); setSupplierCnpj(""); setShowSupplierSuggestions(true); }} placeholder="Buscar fornecedor por nome ou CNPJ" autoComplete="off" className="field w-full text-sm text-foreground" />
            {showSupplierSuggestions && <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-xl bg-background ring-1 ring-border shadow-xl">{supplierSuggestions.map(s => <button key={s.id} type="button" onClick={() => { setSupplier(s.name); setSupplierCnpj(formatCnpj(s.cnpj)); setShowSupplierSuggestions(false); setError(""); }} className="w-full px-3 py-3 text-left text-sm hover:bg-accent border-b border-border/40 last:border-0"><span className="font-semibold text-foreground">{s.name}</span>{s.cnpj && <span className="ml-2 font-mono text-xs text-muted-foreground">{formatCnpj(s.cnpj)}</span>}</button>)}{supplierSuggestions.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">Nenhum fornecedor salvo encontrado.</p>}</div>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="mb-2 block text-sm font-semibold">Número da nota</label><input value={number} onChange={e => setNumber(e.target.value.replace(/\D/g, ""))} inputMode="numeric" pattern="[0-9]*" placeholder="Somente números" className="field w-full text-sm text-foreground" /></div>
            <div><label className="mb-2 block text-sm font-semibold">CNPJ do fornecedor</label><input value={supplierCnpj} readOnly placeholder="Preenchido ao escolher fornecedor" className="field w-full text-sm text-foreground read-only:opacity-80" /></div>
          </div>
          {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <button type="button" disabled={transitioningTo !== null} onClick={() => { if (!supplier.trim()) { setError("Selecione ou informe o fornecedor."); return; } if (!number.trim()) { setError("Informe o número da nota usando somente números."); return; } setError(""); void advanceStep(2); }} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-bold text-primary-foreground disabled:cursor-wait disabled:opacity-80">{transitioningTo === 2 ? <><Loader2 className="h-5 w-5 animate-spin" />Carregando próxima etapa...</> : "Continuar para produtos"}</button>
        </div>}

        {step === 2 && <div className="space-y-4">
          <div className="rounded-xl bg-secondary/60 p-3 text-sm">Fornecedor: <b>{supplier}</b> · CNPJ: <b>{supplierCnpj || "—"}</b></div>
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={productSearch} onChange={e => { setProductSearch(e.target.value); setProductId(""); }} placeholder="Pesquisar produto, código de barras ou REF" autoComplete="off" className="field w-full pl-10 text-sm text-foreground" /></div>
          {productSearch && <div className="overflow-hidden rounded-xl border border-border bg-background">{productSuggestions.map(p => <button key={p.id} type="button" onClick={() => addProduct(p.id)} className="flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left last:border-0 hover:bg-accent"><span className="min-w-0 flex-1"><b className="block text-foreground">{p.name}</b><small className="text-muted-foreground">Código: {p.code} · REF: {p.ref || "—"}</small></span><span className="text-sm text-muted-foreground">Custo: R$ {(p.cost ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><b className="text-primary">+ Adicionar</b></button>)}{productSuggestions.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nenhum produto encontrado.</p>}</div>}
          <div className="flex items-center justify-between"><h2 className="font-semibold text-heading">Produtos da nota ({drafts.length})</h2><span className="text-sm text-muted-foreground">Informe a quantidade esperada</span></div>
          {drafts.length === 0 && <p className="rounded-xl bg-secondary/50 p-4 text-sm text-muted-foreground">Pesquise e selecione os produtos da nota.</p>}
          <div className="space-y-3">{drafts.map(d => { const p = products.find(x => x.id === d.productId); if (!p) return null; const q = Number(d.quantity.replace(",", ".")) || 0; return <div key={d.productId} className="rounded-xl border border-border bg-background p-3"><div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><b className="block text-foreground">{p.name}</b><small className="text-muted-foreground">Código: {p.code} · Estoque atual: {p.stock}</small></div><button type="button" onClick={() => setDrafts(old => old.filter(x => x.productId !== d.productId))} className="rounded-lg bg-secondary px-3 py-2 text-sm text-destructive">Remover</button></div><div className="mt-3 grid grid-cols-2 gap-3"><div><label className="mb-1 block text-xs font-semibold">Quantidade</label><input value={d.quantity} onChange={e => updateQuantity(d.productId, e.target.value)} inputMode="decimal" placeholder={p.unit === "kg" ? "Quantidade em kg" : "Quantidade inteira"} className="field w-full" /></div><div><label className="mb-1 block text-xs font-semibold">Custo unitário</label><div className="field flex w-full items-center">R$ {(p.cost ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div></div><div className="mt-2 text-right text-sm font-semibold">Subtotal: R$ {(q * (p.cost ?? 0)).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>; })}</div>
          {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <div className="flex gap-2"><button type="button" onClick={goBack} disabled={transitioningTo !== null} className="flex-1 rounded-xl bg-secondary py-3 font-semibold text-secondary-foreground">Voltar</button><button type="button" disabled={transitioningTo !== null} onClick={() => { if (!drafts.length) { setError("Adicione pelo menos um produto."); return; } if (drafts.some(d => !d.quantity.trim() || !(Number(d.quantity.replace(",", ".")) > 0))) { setError("Informe uma quantidade válida para todos os produtos."); return; } setError(""); void advanceStep(3); }} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-80">{transitioningTo === 3 ? <><Loader2 className="h-5 w-5 animate-spin" />Carregando confirmação...</> : "Continuar para confirmação"}</button></div>
        </div>}

        {step === 3 && <div className="space-y-4">
          <div className="rounded-xl bg-secondary/60 p-4"><h2 className="font-semibold text-heading">Confirme os dados da nota</h2><div className="mt-2 grid gap-2 text-sm sm:grid-cols-2"><p>Fornecedor: <b>{supplier}</b></p><p>Número da nota: <b>{number}</b></p><p>CNPJ do fornecedor: <b>{supplierCnpj || "—"}</b></p><p>Quantidade de produtos: <b>{drafts.length}</b></p></div></div>
          <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[560px] text-sm"><thead className="bg-secondary/70 text-xs uppercase text-muted-foreground"><tr><th className="px-3 py-3 text-left">Produto</th><th className="px-3 py-3 text-right">Quantidade</th><th className="px-3 py-3 text-right">Custo unitário</th><th className="px-3 py-3 text-right">Total</th></tr></thead><tbody>{productTotals.map(({ draft, product, quantity, unitCost, total }) => product && <tr key={draft.productId} className="border-t border-border/70"><td className="px-3 py-3 font-medium text-foreground">{product.name}<div className="text-xs text-muted-foreground">{product.code}</div></td><td className="px-3 py-3 text-right">{quantity} {product.unit === "kg" ? "kg" : "un."}</td><td className="px-3 py-3 text-right">R$ {unitCost.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td className="px-3 py-3 text-right font-semibold">R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>)}</tbody><tfoot><tr className="border-t-2 border-border bg-secondary/40"><td colSpan={3} className="px-3 py-3 text-right font-bold">Total estimado</td><td className="px-3 py-3 text-right font-bold">R$ {subtotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr></tfoot></table></div>
          <p className="text-xs text-muted-foreground">Os valores são estimados com base no custo cadastrado dos produtos. A nota será encaminhada para conferência; o estoque não será alterado nesta etapa.</p>
          {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <div className="flex gap-2"><button type="button" onClick={goBack} disabled={savingNote} className="flex-1 rounded-xl bg-secondary py-3 font-semibold text-secondary-foreground">Voltar para produtos</button><button type="button" onClick={() => void save()} disabled={savingNote} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:cursor-wait disabled:opacity-80">{savingNote ? <><Loader2 className="h-5 w-5 animate-spin" />Salvando nota...</> : "Confirmar e enviar para conferência"}</button></div>
        </div>}
      </div>}
    </section>

    {!showNewNote && <section className="glass p-4 mt-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><History className="h-5 w-5" /></div><h2 className="font-display text-xl text-heading">Histórico de notas</h2></div><button type="button" onClick={() => setShowFilters(v => !v)} aria-expanded={showFilters} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground hover:bg-accent"><Filter className="h-4 w-4" />{showFilters ? "Fechar" : "Filtrar"}</button></div>
      {showFilters && <div className="mb-4 grid gap-3 rounded-xl border border-border bg-background p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><label className="mb-1 block text-xs font-semibold">Data inicial</label><input type="date" value={filterStart} onChange={e => setFilterStart(e.target.value)} className="field w-full" /></div>
        <div><label className="mb-1 block text-xs font-semibold">Data final</label><input type="date" value={filterEnd} min={filterStart || undefined} onChange={e => setFilterEnd(e.target.value)} className="field w-full" /></div>
        <div><label className="mb-1 block text-xs font-semibold">Número da NF</label><input value={filterNumber} onChange={e => setFilterNumber(e.target.value)} placeholder="Número da NF" className="field w-full" /></div>
        <div><label className="mb-1 block text-xs font-semibold">Fornecedor</label><input value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)} placeholder="Nome ou CNPJ do fornecedor" className="field w-full" /></div>
        <div className="sm:col-span-2 lg:col-span-4"><button type="button" onClick={() => { setFilterStart(""); setFilterEnd(""); setFilterNumber(""); setFilterSupplier(""); }} className="rounded-lg bg-secondary px-3 py-2 text-sm font-semibold">Limpar filtros</button></div>
      </div>}
      <div className="divide-y divide-border/50">
        {!filteredNotes.length && <p className="py-8 text-center font-mono text-[11px] text-muted-foreground">{notes.length ? "nenhuma nota corresponde aos filtros" : "nenhuma nota cadastrada"}</p>}
        {filteredNotes.map(n => <div key={n.id} className="py-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-56"><div className="font-semibold text-foreground">NF {n.number}</div><div className="font-mono text-[11px] text-muted-foreground">{n.supplier}{n.supplierCnpj ? ` · ${n.supplierCnpj}` : ""} · ${n.items.length} produtos${n.extras?.length ? ` · ${n.extras.length} extras` : ""}</div></div>
          <span className={`font-mono text-[11px] rounded-md px-2 py-1 ${n.status === "divergente" ? "bg-destructive/15 text-destructive" : n.status === "aceito" || n.status === "conferido" ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground"}`}>{n.status}</span>
          <button onClick={() => navigate({ to: "/recebimento", search: { nota: n.id } as any })} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm font-semibold text-secondary-foreground">Abrir</button>
          {n.status === "pendente" && <button onClick={() => navigate({ to: "/conferencia", search: { nota: n.id } as any })} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-semibold">Conferir</button>}
          {(n.status === "divergente" || n.status === "conferido") && <div className="flex gap-2"><button onClick={() => actions.acceptReceiving(n.id)} disabled={!!n.stockReleased} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-bold disabled:opacity-50">{n.stockReleased ? "Estoque já liberado" : "Aceitar e liberar estoque"}</button>{!n.stockReleased && <button onClick={() => actions.rejectReceiving(n.id)} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm font-semibold text-secondary-foreground">Rejeitar</button>}</div>}
          {n.status === "rejeitado" && <span className="text-[11px] text-muted-foreground">estoque não alterado</span>}
        </div>)}
      </div>
    </section>}
  </div>;
}

function expiryInfo(expiry?: string) {
  if (!expiry) return null;
  const value = expiry.trim();
  let year = 0, month = 0, day = 0;
  const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (br) [, day, month, year] = br.map(Number) as [number, number, number, number];
  else if (iso) [, year, month, day] = iso.map(Number) as [number, number, number, number];
  else return { label: value, className: "text-foreground bg-secondary" };

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return { label: value + " · data inválida", className: "bg-red-600/15 text-red-700 ring-1 ring-red-600/30" };
  }

  const now = new Date();
  const todayTime = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.floor((parsed.getTime() - todayTime) / 86400000);
  if (days < 30) return { label: `${value} · ${days < 0 ? "vencido" : `${days} dias`}`, className: "bg-red-600/15 text-red-700 ring-1 ring-red-600/30" };
  if (days <= 60) return { label: `${value} · ${days} dias`, className: "bg-orange-500/15 text-orange-700 ring-1 ring-orange-500/30" };
  return { label: value, className: "bg-emerald-600/10 text-emerald-700" };
}

function ReceivingDetail({ note, onBack }: { note: ReceivingNote; onBack: () => void }) {
  const products = useStore((s) => s.products);
  const conference = useStore((s) => s.conferences.find(c => c.receivingId === note.id));
  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [qty, setQty] = useState("");
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const productSuggestions = products.filter(p => {
    const term = productSearch.trim().toLowerCase();
    return !term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term) || (p.barcodes ?? []).some(code => code.toLowerCase().includes(term));
  }).slice(0, 8);
  const addProduct = () => {
    const n = Number(qty.replace(",", "."));
    if (!productId || !Number.isFinite(n) || n <= 0) return;
    actions.addReceivingItems(note.id, [{ productId, expected: n }]);
    setProductId("");
    setProductSearch("");
    setQty("");
  };
  const receivedByProduct = new Map(note.items.map((i: any) => [i.productId, i.received ?? conference?.counts?.[i.productId] ?? 0]));
  return <section className="glass p-4 mt-4">
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <button onClick={onBack} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm text-secondary-foreground">← Voltar</button>
      <div className="flex-1"><div className="font-display text-2xl tracking-[.12em] text-heading">NF {note.number}</div><div className="font-mono text-[11px] text-muted-foreground">{note.supplier}{note.supplierCnpj ? ` · CNPJ ${note.supplierCnpj}` : ""}</div></div>
      <span className="font-mono text-[11px] rounded-md px-2 py-1 bg-secondary text-secondary-foreground">{note.status === "analisando" ? "Analisando" : note.stockReleased && Object.values(note.decisions ?? {}).includes("devolver") ? "Ação necessária" : note.stockReleased ? "Liberado" : note.status}</span>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
      <div className="rounded-xl bg-secondary/60 p-3"><div className="label-mono">Produtos</div><div className="text-lg font-bold text-foreground">{note.items.length}</div></div>
      <div className="rounded-xl bg-secondary/60 p-3"><div className="label-mono">Esperado</div><div className="text-lg font-bold text-foreground">{note.items.reduce((s: number, i: any) => s + i.expected, 0)}</div></div>
      <div className="rounded-xl bg-secondary/60 p-3"><div className="label-mono">Recebido</div><div className="text-lg font-bold text-foreground">{note.items.reduce((s: number, i: any) => s + Number(receivedByProduct.get(i.productId) || 0), 0)}</div></div>
      <div className="rounded-xl bg-secondary/60 p-3"><div className="label-mono">Situação</div><div className="text-lg font-bold text-foreground">{note.status}</div></div>
    </div>
    {note.status === "pendente" && <div className="mt-4 rounded-xl bg-secondary/50 ring-1 ring-border p-3">
      <div className="font-semibold text-foreground mb-2">Adicionar produtos à nota</div>
      <div className="grid grid-cols-[1fr_120px_auto] gap-2">
        <div className="relative">
          <input value={productSearch} onChange={e => { setProductSearch(e.target.value); if (!e.target.value) setProductId(""); }} placeholder="Pesquisar produto ou código" className="field w-full text-sm text-foreground" />
          {productSearch && !productId && <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-xl bg-background ring-1 ring-border shadow-xl">
            {productSuggestions.map(p => <button key={p.id} type="button" onClick={() => { setProductId(p.id); setProductSearch(p.name); }} className="w-full px-3 py-2 text-left text-sm hover:bg-accent border-b border-border/40 last:border-0"><span className="font-medium text-foreground">{p.name}</span><span className="ml-2 font-mono text-xs text-muted-foreground">{p.code}</span></button>)}
            {!productSuggestions.length && <div className="px-3 py-3 text-xs text-muted-foreground">Nenhum produto encontrado.</div>}
          </div>}
        </div>
        <input value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9,.]/g, ""))} inputMode="decimal" placeholder="Quantidade" className="field text-sm text-foreground" />
        <button type="button" onClick={addProduct} disabled={!productId || !qty} className="rounded-xl bg-primary text-primary-foreground px-4 py-2 font-bold disabled:opacity-40">+ Adicionar</button>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">Pode incluir produtos depois de salvar, enquanto a conferência ainda não foi finalizada.</div>
    </div>}
    
    {note.status === "analisando" && <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">Nota grande? Marque todos os produtos como aceitos de uma vez.</p>
      <button type="button" onClick={() => { if (confirm("Marcar todos os produtos e extras desta nota como ACEITAR? Você ainda poderá alterar decisões individuais antes de finalizar.")) { [...note.items.map(i => i.productId), ...(note.extras ?? []).map(i => i.productId)].forEach(key => actions.setReceivingDecision(note.id, key, "aceitar")); } }} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700">✓ ACEITAR TUDO</button>
    </div>}
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] table-auto text-[13px]"><thead><tr className="label-mono text-left"><th className="py-2 pr-4">Produto</th><th className="px-3 py-2 text-right whitespace-nowrap">Esperado</th><th className="px-3 py-2 text-right whitespace-nowrap">Recebido</th><th className="px-4 py-2 text-right whitespace-nowrap">Diferença</th><th className="pl-4 pr-3 py-2 text-left whitespace-nowrap">Validade</th><th className="pl-3 py-2 text-right whitespace-nowrap">Decisão</th></tr></thead>
      <tbody className="divide-y divide-border/50">
      {note.items.map((i: any) => { const received=Number(receivedByProduct.get(i.productId)||0); const diff=received-i.expected; const p=products.find(x=>x.id===i.productId); const decision=note.decisions?.[i.productId]; return <tr key={i.productId}><td className="py-3"><div className="text-foreground">{i.name}</div><div className="font-mono text-[10px] text-muted-foreground">{p?.code}</div></td><td className="text-right font-mono">{i.expected} {i.unit==="kg"?"kg":"un."}</td><td className="text-right font-mono">{received} {i.unit==="kg"?"kg":"un."}</td><td className={`px-4 text-right font-mono whitespace-nowrap ${diff===0?"text-primary":"text-destructive"}`}>{diff>0?"+":""}{diff} {i.unit==="kg"?"kg":"un."}</td><td className="py-2 pl-4 pr-3 whitespace-nowrap">{i.expiry ? (() => { const info = expiryInfo(i.expiry); return info ? <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold whitespace-nowrap ${info.className}`}>{info.label}</span> : "—"; })() : <span className="text-xs text-muted-foreground">—</span>}</td><td className="py-2"><div className="flex justify-end gap-1">{note.status === "analisando" ? <><button type="button" onClick={() => actions.setReceivingDecision(note.id, i.productId, "aceitar")} className={`rounded-md px-2 py-1 text-xs font-semibold ${decision==="aceitar"?"bg-emerald-600 text-white":"bg-secondary text-secondary-foreground"}`}>Aceitar</button><button type="button" onClick={() => actions.setReceivingDecision(note.id, i.productId, "devolver")} className={`rounded-md px-2 py-1 text-xs font-semibold ${decision==="devolver"?"bg-amber-600 text-white":"bg-secondary text-secondary-foreground"}`}>Devolver</button></> : decision ? <span className={decision==="aceitar"?"text-emerald-700":"text-amber-700"}>{decision==="aceitar"?"Aceito":"Devolver"}</span> : "—"}</div></td></tr>; })}
      {note.extras?.map((extra) => { const decision=note.decisions?.[extra.productId]; return <tr key={"extra-" + extra.productId}><td className="py-3"><div className="text-destructive">{extra.name} <span className="text-[10px]">(extra)</span></div><div className="font-mono text-[10px] text-muted-foreground">{products.find(p => p.id === extra.productId)?.code || "Sem código"}{extra.expiry ? ` · Validade ${extra.expiry}` : ""}</div></td><td className="text-right font-mono">0 {extra.unit === "kg" ? "kg" : "un."}</td><td className="text-right font-mono">{extra.received} {extra.unit === "kg" ? "kg" : "un."}</td><td className="px-4 text-right font-mono text-destructive whitespace-nowrap">+{extra.received} {extra.unit === "kg" ? "kg" : "un."}</td><td className="py-2 pl-4 pr-3 whitespace-nowrap">{extra.expiry ? (() => { const info = expiryInfo(extra.expiry); return info ? <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold whitespace-nowrap ${info.className}`}>{info.label}</span> : "—"; })() : <span className="text-xs text-muted-foreground">—</span>}</td><td className="py-2"><div className="flex justify-end gap-1">{note.status === "analisando" ? <><button type="button" onClick={() => actions.setReceivingDecision(note.id, extra.productId, "aceitar")} className={`rounded-md px-2 py-1 text-xs font-semibold ${decision==="aceitar"?"bg-emerald-600 text-white":"bg-secondary text-secondary-foreground"}`}>Aceitar</button><button type="button" onClick={() => actions.setReceivingDecision(note.id, extra.productId, "devolver")} className={`rounded-md px-2 py-1 text-xs font-semibold ${decision==="devolver"?"bg-amber-600 text-white":"bg-secondary text-secondary-foreground"}`}>Devolver</button></> : decision ? <span className={decision==="aceitar"?"text-emerald-700":"text-amber-700"}>{decision==="aceitar"?"Aceito":"Devolver"}</span> : "—"}</div></td></tr>; })}
      </tbody></table>
      {note.status === "analisando" && <div className="mt-4 flex flex-col gap-2"><div className="text-sm text-muted-foreground">Escolha Aceitar ou Devolver para cada produto, inclusive os extras. O estoque só recebe as quantidades aceitas.</div><button type="button" onClick={async () => { setDecisionSaving(true); setDecisionError(""); try { const ok = await actions.completeReceivingDecision(note.id); if (!ok) setDecisionError("Não foi possível confirmar a liberação no servidor. A conferência e as decisões foram mantidas; tente finalizar novamente. Você não precisa conferir os produtos outra vez."); } catch { setDecisionError("Ocorreu um erro ao finalizar. Tente novamente."); } finally { setDecisionSaving(false); } }} disabled={decisionSaving || [...note.items.map(i => i.productId), ...(note.extras ?? []).map(i => i.productId)].some(key => !note.decisions?.[key])} className="w-full rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-50">{decisionSaving ? "Salvando decisões e atualizando estoque..." : "Finalizar decisões e liberar estoque aceito"}</button>{decisionError && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{decisionError}</p>}</div>}
      {note.stockReleased && <div className="mt-4 rounded-xl bg-secondary/60 p-3 text-sm">Estoque atualizado apenas com os produtos marcados como aceitos. {Object.values(note.decisions ?? {}).includes("devolver") ? "Há produtos marcados para devolução; confira os detalhes acima." : "Todas as quantidades aceitas foram liberadas."}</div>}
    </div>
  </section>;
}
