import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Filter, Search, History, ReceiptText, ChevronDown } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { brl, printReceipt, useStore } from "@/lib/store";

export const Route = createFileRoute("/historico-vendas")({
  head: () => ({ meta: [{ title: "MobFlow — Histórico de vendas" }, { name: "description", content: "Consulte e gere comprovantes das suas próprias vendas." }] }),
  component: HistoricoVendas,
});

function HistoricoVendas() {
  const sales = useStore((s) => s.sales);
  const companyName = useStore((s) => s.settings.companyName);
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const today = new Date();
  const todayKey = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [dateMode, setDateMode] = useState<"month" | "range">("month");
  const [month, setMonth] = useState(todayKey.slice(0, 7));
  const [startDate, setStartDate] = useState(todayKey);
  const [endDate, setEndDate] = useState(todayKey);
  const [expanded, setExpanded] = useState<string[]>([]);

  useEffect(() => {
    const name = sessionStorage.getItem("mobflow-username")?.trim() || "";
    let permissions: string[] = [];
    try { permissions = JSON.parse(sessionStorage.getItem("mobflow-permissions") || "[]").map((p: string) => p === "Conferência" ? "Operações" : p); } catch {}
    const allowed = !!name && permissions.includes("PDV") && sessionStorage.getItem("mobflow-pdv-authorized") === "1";
    setUsername(name);
    setAuthorized(allowed);
    if (!allowed) navigate({ to: "/" });
  }, [navigate]);

  const ownSales = useMemo(() => sales.filter((sale) => !!username && (sale.seller || "").trim().toLocaleLowerCase("pt-BR") === username.toLocaleLowerCase("pt-BR")), [sales, username]);
  const productOptions = useMemo(() => Array.from(new Set(ownSales.flatMap((sale) => sale.items.map((item) => item.name)))).sort((a, b) => a.localeCompare(b, "pt-BR")), [ownSales]);
  const filteredSales = useMemo(() => ownSales.filter((sale) => {
    const date = new Date(sale.date);
    const key = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    const inPeriod = dateMode === "month" ? key.slice(0, 7) === month : startDate <= endDate && key >= startDate && key <= endDate;
    const term = searchText.trim().toLocaleLowerCase("pt-BR");
    const matchesText = !term || sale.id.toLocaleLowerCase("pt-BR").includes(term) || (sale.customer || "").toLocaleLowerCase("pt-BR").includes(term) || sale.items.some((item) => item.name.toLocaleLowerCase("pt-BR").includes(term));
    const matchesProduct = !productFilter || sale.items.some((item) => item.name === productFilter);
    return inPeriod && matchesText && matchesProduct;
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [ownSales, dateMode, month, startDate, endDate, searchText, productFilter]);
  const total = filteredSales.reduce((sum, sale) => sum + sale.total, 0);
  const periodLabel = dateMode === "month" ? new Date(month + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) : startDate.split("-").reverse().join("/") + " a " + endDate.split("-").reverse().join("/");

  if (!authorized) return <div className="min-h-screen bg-background" />;

  return <div className="mfb-in min-h-screen p-4 md:p-6">
    <AppHeader />
    <main className="mx-auto max-w-6xl space-y-4">
      <section className="glass p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><History className="h-5 w-5" /></div><div><h1 className="font-display text-2xl text-heading">Histórico de vendas</h1><p className="text-sm text-muted-foreground">Exibindo somente as vendas registradas no seu usuário.</p></div></div>
          <button type="button" onClick={() => setFiltersOpen((value) => !value)} className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground hover:bg-accent"><Filter className="h-4 w-4" />{filtersOpen ? "Fechar filtros" : "Filtrar"}</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-background/70 p-4"><div className="text-sm text-muted-foreground">Vendas no período</div><div className="mt-1 font-display text-3xl text-heading">{filteredSales.length}</div></div>
          <div className="rounded-xl border border-border bg-background/70 p-4"><div className="text-sm text-muted-foreground">Total vendido</div><div className="mt-1 font-display text-3xl text-primary">R$ {brl(total)}</div></div>
        </div>
        {filtersOpen && <div className="mt-4 grid gap-3 rounded-xl border border-border bg-secondary/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm text-muted-foreground sm:col-span-2">Buscar venda, código, produto ou cliente<div className="relative mt-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" /><input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Digite para pesquisar" className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-foreground" /></div></label>
          <label className="text-sm text-muted-foreground">Produto<select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"><option value="">Todos os produtos</option>{productOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          <label className="text-sm text-muted-foreground">Período<select value={dateMode} onChange={(e) => setDateMode(e.target.value as "month" | "range")} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"><option value="month">Por mês</option><option value="range">Data personalizada</option></select></label>
          {dateMode === "month" ? <label className="text-sm text-muted-foreground">Mês<input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" /></label> : <><label className="text-sm text-muted-foreground">Data inicial<input type="date" value={startDate} max={endDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" /></label><label className="text-sm text-muted-foreground">Data final<input type="date" value={endDate} min={startDate} onChange={(e) => e.target.value && setEndDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground" /></label></>}
          <div className="flex items-end"><button type="button" onClick={() => { setSearchText(""); setProductFilter(""); setDateMode("month"); setMonth(todayKey.slice(0, 7)); setStartDate(todayKey); setEndDate(todayKey); }} className="rounded-lg px-3 py-2 font-semibold text-primary hover:bg-accent">Limpar filtros</button></div>
        </div>}
      </section>
      <section className="glass p-4">
        <div className="mb-3 text-sm text-muted-foreground">Período: <strong className="capitalize text-foreground">{periodLabel}</strong></div>
        {filteredSales.length === 0 ? <p className="py-12 text-center text-muted-foreground">Nenhuma venda sua encontrada neste período.</p> : <div className="space-y-3">{filteredSales.map((sale) => {
          const isExpanded = expanded.includes(sale.id);
          return <article key={sale.id} className="rounded-xl border border-border bg-background/50 p-3 md:p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div><div className="font-semibold text-foreground">{new Date(sale.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</div><div className="mt-1 text-sm text-muted-foreground">{sale.customer ? "Cliente: " + sale.customer : "Venda balcão"} · {sale.payment}</div><div className="mt-1 text-xs text-muted-foreground">Comprovante: {sale.id}</div></div>
              <div className="flex items-center justify-between gap-3 sm:justify-end"><strong className="font-mono text-lg text-heading">R$ {brl(sale.total)}</strong><button type="button" onClick={() => setExpanded((current) => isExpanded ? current.filter((id) => id !== sale.id) : [...current, sale.id])} className="inline-flex items-center gap-1 rounded-lg bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground"><span>{isExpanded ? "Fechar" : "Detalhes"}</span><ChevronDown className={"h-4 w-4 transition-transform " + (isExpanded ? "rotate-180" : "")} /></button></div>
            </div>
            {isExpanded && <div className="mt-3 space-y-2 border-t border-border pt-3">{sale.items.map((item, index) => <div key={sale.id + "-" + index} className="flex items-center justify-between gap-3 text-sm"><span className="text-foreground">{item.name} <span className="text-muted-foreground">× {item.qty}{item.unit === "kg" ? " kg" : " un."}</span></span><span className="font-mono text-foreground">R$ {brl(item.price * item.qty)}</span></div>)}<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><span className="text-sm text-muted-foreground">Vendedor: {sale.seller || username}</span><button type="button" onClick={() => printReceipt(sale, companyName)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground hover:bg-primary/90"><ReceiptText className="h-4 w-4" />Gerar comprovante</button></div></div>}
          </article>;
        })}</div>}
      </section>
    </main>
  </div>;
}
