import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Filter, Search } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { brl, printReceipt, useStore } from "@/lib/store";

export const Route = createFileRoute("/vendas")({
  head: () => ({
    meta: [
      { title: "MobFlow — Histórico de Vendas" },
      { name: "description", content: "Veja as vendas do dia, faturamento e formas de pagamento no MobFlow." },
      { property: "og:title", content: "MobFlow — Histórico de Vendas" },
      { property: "og:description", content: "Faturamento e histórico de vendas do seu PDV." },
    ],
  }),
  component: Vendas,
});

function Vendas() {
  const sales = useStore((s) => s.sales);
  const companyName = useStore((s) => s.settings.companyName);
  const [dateFilterMode, setDateFilterMode] = useState<"month" | "range">("month");
  const todayKey = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0");
  const [selectedMonth, setSelectedMonth] = useState(todayKey.slice(0, 7));
  const [rangeStart, setRangeStart] = useState(todayKey);
  const [rangeEnd, setRangeEnd] = useState(todayKey);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("todos");
  const navigate = useNavigate();
  useEffect(() => {
    if (sessionStorage.getItem("mobflow-management") !== "1") navigate({ to: "/gerencia" });
  }, [navigate]);
  const today = new Date().toDateString();
  const todays = sales.filter((s) => new Date(s.date).toDateString() === today);
  const sum = (arr: typeof sales) => arr.reduce((t, s) => t + s.total, 0);
  const byPay = (["Dinheiro", "Cartão", "Pix"] as const).map((m) => [m, sum(todays.filter((s) => s.payment === m))] as const);
  const productOptions = useMemo(() => Array.from(new Set(sales.flatMap(s => s.items.map(i => i.name))).values()).sort((a, b) => a.localeCompare(b, "pt-BR")), [sales]);
  const filteredSales = useMemo(() => sales.filter((s) => {
    const d = new Date(s.date);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const inPeriod = dateFilterMode === "month" ? key.slice(0, 7) === selectedMonth : rangeStart <= rangeEnd && key >= rangeStart && key <= rangeEnd;
    const term = searchText.trim().toLocaleLowerCase("pt-BR");
    const matchesSearch = !term || s.id.toLocaleLowerCase("pt-BR").includes(term) || s.customer?.toLocaleLowerCase("pt-BR").includes(term) || s.items.some(i => i.name.toLocaleLowerCase("pt-BR").includes(term));
    const matchesProduct = !productFilter || s.items.some(i => i.name === productFilter);
    const matchesPayment = paymentFilter === "todos" || s.payment === paymentFilter;
    return inPeriod && matchesSearch && matchesProduct && matchesPayment;
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [sales, dateFilterMode, selectedMonth, rangeStart, rangeEnd, searchText, productFilter, paymentFilter]);
  const monthLabel = new Date(selectedMonth + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const periodLabel = dateFilterMode === "month" ? monthLabel : rangeStart.split("-").reverse().join("/") + " a " + rangeEnd.split("-").reverse().join("/");

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        <div className="glass p-4"><div className="label-mono">Faturamento hoje</div><div className="font-display text-4xl mt-1 text-primary">R$ {brl(sum(todays))}</div></div>
        <div className="glass p-4"><div className="label-mono">Vendas hoje</div><div className="font-display text-4xl mt-1 text-heading">{todays.length}</div></div>
        {byPay.map(([m, v]) => (
          <div key={m} className="glass p-4"><div className="label-mono">{m}</div><div className="font-display text-4xl mt-1 text-heading">R$ {brl(v)}</div></div>
        ))}
      </div>
      <section className="glass p-4">
        <div className="flex justify-end mb-3"><button onClick={() => navigate({ to: "/gerencia" })} className="rounded-xl bg-secondary px-4 py-2 text-sm text-secondary-foreground hover:bg-accent">← Voltar para gerência</button></div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><div className="label-mono">Histórico de vendas</div><p className="mt-1 text-sm text-muted-foreground">Pesquise vendas por código do comprovante, produto ou cliente.</p></div>
          <button type="button" onClick={() => setFiltersOpen(open => !open)} aria-expanded={filtersOpen} className="inline-flex items-center gap-2 rounded-xl bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground hover:bg-accent">
            <Filter className="h-4 w-4" /> Filtros {filtersOpen ? <ChevronDown className="h-4 w-4 rotate-180" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
        {filtersOpen && <div className="mb-4 grid gap-3 rounded-xl border border-border bg-secondary/30 p-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-medium text-muted-foreground sm:col-span-2">Buscar venda, código do comprovante, produto ou cliente
            <div className="relative mt-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Ex.: código ABC..., arroz, cliente" className="block w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground" /></div>
          </label>
          <label className="text-xs font-medium text-muted-foreground">Produto
            <select value={productFilter} onChange={e => setProductFilter(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="">Todos os produtos</option>{productOptions.map(name => <option key={name} value={name}>{name}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">Forma de pagamento
            <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="todos">Todas</option><option value="Dinheiro">Dinheiro</option><option value="Cartão">Cartão</option><option value="Pix">Pix</option></select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">Filtrar por data
            <select value={dateFilterMode} onChange={e => setDateFilterMode(e.target.value as "month" | "range")} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="month">Mês</option><option value="range">Período personalizado</option></select>
          </label>
          {dateFilterMode === "month" ? <label className="text-xs font-medium text-muted-foreground">Selecionar mês
            <input type="month" aria-label="Selecionar mês" value={selectedMonth} onChange={e => e.target.value && setSelectedMonth(e.target.value)} className="mt-1 block w-full cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </label> : <>
            <label className="text-xs font-medium text-muted-foreground">Data inicial
              <input type="date" aria-label="Data inicial" value={rangeStart} max={rangeEnd} onChange={e => e.target.value && setRangeStart(e.target.value)} className="mt-1 block w-full cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
            </label>
            <label className="text-xs font-medium text-muted-foreground">Data final
              <input type="date" aria-label="Data final" value={rangeEnd} min={rangeStart} onChange={e => e.target.value && setRangeEnd(e.target.value)} className="mt-1 block w-full cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
            </label>
          </>}
          <div className="flex items-end"><button type="button" onClick={() => { setSearchText(""); setProductFilter(""); setPaymentFilter("todos"); setDateFilterMode("month"); setSelectedMonth(todayKey.slice(0, 7)); setRangeStart(todayKey); setRangeEnd(todayKey); }} className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-accent">Limpar filtros</button></div>
        </div>}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Período: <strong className="capitalize text-foreground">{periodLabel}</strong></span>
          <span className="font-semibold text-foreground">{filteredSales.length} venda(s) · R$ {brl(sum(filteredSales))}</span>
        </div>
        <div className="divide-y divide-border/50">
          {filteredSales.length === 0 && <p className="py-10 text-center font-mono text-[11px] text-muted-foreground">Nenhuma venda encontrada nesse período.</p>}
          {filteredSales.map((s) => (
            <div key={s.id} className="py-3 flex flex-wrap items-center gap-4 text-[13px]">
              <span className="font-mono text-[11px] text-muted-foreground w-36">{new Date(s.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
              <span className="flex-1 min-w-48 text-foreground truncate">{s.customer ? `${s.customer} — ` : ""}{s.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</span>
              <span className="font-mono text-[11px] rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">{s.payment}</span>
              <span className="font-mono text-heading w-28 text-right">R$ {brl(s.total)}</span>
              <button onClick={() => printReceipt(s, companyName) className="font-mono text-[11px] rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground hover:text-foreground">🧾 comprovante</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
