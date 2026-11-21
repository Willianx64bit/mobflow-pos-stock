import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { brl, useStore } from "@/lib/store";
import { ArrowLeft, CalendarDays, ChartNoAxesCombined, PackageMinus, ReceiptText, TrendingDown, Wallet } from "lucide-react";

export const Route = createFileRoute("/analise-resultados")({
  head: () => ({ meta: [{ title: "MobFlow — Analisar resultados da empresa" }] }),
  component: AnaliseResultados,
});

function AnaliseResultados() {
  const navigate = useNavigate();
  const sales = useStore((s) => s.sales ?? []);
  const writeoffs = useStore((s) => s.stockWriteoffs ?? []);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [dateMode, setDateMode] = useState<"month" | "range">("month");
  const [month, setMonth] = useState(todayKey.slice(0, 7));
  const [startDate, setStartDate] = useState(todayKey.slice(0, 8) + "01");
  const [endDate, setEndDate] = useState(todayKey);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("mobflow-management") !== "1") navigate({ to: "/gerencia", replace: true });
  }, [navigate]);

  const filteredSales = useMemo(() => sales.filter((sale) => {
    const date = new Date(sale.date);
    if (Number.isNaN(date.getTime())) return false;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return dateMode === "month" ? key.slice(0, 7) === month : startDate <= endDate && key >= startDate && key <= endDate;
  }), [sales, dateMode, month, startDate, endDate]);
  const filteredWriteoffs = useMemo(() => writeoffs.filter((item) => {
    const date = new Date(item.date);
    if (Number.isNaN(date.getTime())) return false;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return dateMode === "month" ? key.slice(0, 7) === month : startDate <= endDate && key >= startDate && key <= endDate;
  }), [writeoffs, dateMode, month, startDate, endDate]);
  const revenue = filteredSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const profitData = filteredSales.reduce((result, sale) => {
    if (typeof sale.profit === "number" && Number.isFinite(sale.profit)) {
      result.total += sale.profit;
      return result;
    }
    const hasCostSnapshot = (sale.items ?? []).every((item) => typeof item.cost === "number" && Number.isFinite(item.cost));
    if (!hasCostSnapshot) {
      result.incomplete += 1;
      return result;
    }
    const cost = sale.items.reduce((sum, item) => sum + Number(item.cost) * item.qty, 0);
    result.total += sale.total - cost;
    return result;
  }, { total: 0, incomplete: 0 });
  const writeoffTotal = filteredWriteoffs.reduce((sum, entry) => sum + (entry.items ?? []).reduce((itemsSum, item) => itemsSum + Number(item.totalCost || 0), 0), 0);
  const writeoffsByReason = (["Perda", "Consumo", "Doação"] as const).map((reason) => ({
    reason,
    total: filteredWriteoffs.filter((entry) => entry.reason === reason).reduce((sum, entry) => sum + (entry.items ?? []).reduce((itemsSum, item) => itemsSum + Number(item.totalCost || 0), 0), 0),
    count: filteredWriteoffs.filter((entry) => entry.reason === reason).length,
  }));
  const resultAfterWriteoffs = profitData.total - writeoffTotal;
  const periodLabel = dateMode === "month"
    ? new Date(month + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    : startDate.split("-").reverse().join("/") + " a " + endDate.split("-").reverse().join("/");

  const money = (value: number) => "R$ " + brl(value);

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="mx-auto max-w-7xl space-y-4">
        <section className="glass p-4 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><ChartNoAxesCombined className="h-5 w-5" /></div>
              <div><h1 className="font-display text-2xl text-heading">Analisar resultados da empresa</h1><p className="text-sm text-muted-foreground">Visão geral do desempenho no período selecionado.</p></div>
            </div>
            <button type="button" onClick={() => navigate({ to: "/gerencia" })} className="inline-flex items-center gap-2 rounded-xl bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground hover:bg-accent"><ArrowLeft className="h-4 w-4" />Voltar para gerência</button>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-secondary/30 p-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4" />Período: <strong className="capitalize text-foreground">{periodLabel}</strong></div>
            <button type="button" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground">{filtersOpen ? "Fechar filtros" : "Alterar período"}</button>
          </div>
          {filtersOpen && <div className="mt-3 grid gap-3 rounded-xl border border-border bg-secondary/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-semibold text-muted-foreground">Tipo de período<select value={dateMode} onChange={(event) => setDateMode(event.target.value as "month" | "range")} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground"><option value="month">Mês</option><option value="range">Data personalizada</option></select></label>
            {dateMode === "month" ? <label className="text-xs font-semibold text-muted-foreground">Mês<input type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground" /></label> : <>
              <label className="text-xs font-semibold text-muted-foreground">Data inicial<input type="date" value={startDate} max={endDate} onChange={(event) => event.target.value && setStartDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground" /></label>
              <label className="text-xs font-semibold text-muted-foreground">Data final<input type="date" value={endDate} min={startDate} onChange={(event) => event.target.value && setEndDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground" /></label>
            </>}
            <div className="flex items-end"><button type="button" onClick={() => { setDateMode("month"); setMonth(todayKey.slice(0, 7)); setStartDate(todayKey.slice(0, 8) + "01"); setEndDate(todayKey); }} className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-accent">Voltar ao mês atual</button></div>
          </div>}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="glass p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><ReceiptText className="h-4 w-4" />Faturamento em vendas</div><div className="mt-2 font-display text-3xl text-primary">{money(revenue)}</div><p className="mt-1 text-xs text-muted-foreground">{filteredSales.length} venda(s) registradas</p></div>
          <div className="glass p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="h-4 w-4" />Lucro bruto registrado</div><div className="mt-2 font-display text-3xl text-primary">{money(profitData.total)}</div><p className="mt-1 text-xs text-muted-foreground">Antes do impacto das baixas e despesas</p></div>
          <div className="glass p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><PackageMinus className="h-4 w-4" />Custo das baixas</div><div className="mt-2 font-display text-3xl text-destructive">{money(writeoffTotal)}</div><p className="mt-1 text-xs text-muted-foreground">{filteredWriteoffs.length} operação(ões) de baixa</p></div>
          <div className="glass p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><TrendingDown className="h-4 w-4" />Resultado após baixas</div><div className={`mt-2 font-display text-3xl ${resultAfterWriteoffs >= 0 ? "text-primary" : "text-destructive"}`}>{money(resultAfterWriteoffs)}</div><p className="mt-1 text-xs text-muted-foreground">Lucro bruto menos custo das baixas</p></div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="glass p-4 md:p-5">
            <h2 className="font-display text-lg text-heading">Composição das baixas</h2>
            <p className="mb-3 text-sm text-muted-foreground">Valores pelo custo registrado em cada operação.</p>
            <div className="divide-y divide-border">
              {writeoffsByReason.map((item) => <div key={item.reason} className="flex items-center justify-between gap-3 py-3"><div><div className="font-semibold text-foreground">{item.reason}</div><div className="text-xs text-muted-foreground">{item.count} operação(ões)</div></div><div className="font-semibold tabular-nums text-foreground">{money(item.total)}</div></div>)}
              <div className="flex items-center justify-between gap-3 py-3 font-bold"><span>Total das baixas</span><span>{money(writeoffTotal)}</span></div>
            </div>
          </div>
          <div className="glass p-4 md:p-5">
            <h2 className="font-display text-lg text-heading">Conferência dos dados</h2>
            <p className="mt-2 text-sm text-muted-foreground">Os indicadores usam os registros salvos no MobFlow para o período selecionado.</p>
            <div className="mt-3 rounded-xl border border-border bg-secondary/30 p-3">
              <div className="text-sm font-semibold text-foreground">{profitData.incomplete === 0 ? "Custos das vendas disponíveis" : "Existem vendas com custo incompleto"}</div>
              <p className="mt-1 text-sm text-muted-foreground">{profitData.incomplete === 0 ? "O lucro bruto foi calculado com o lucro salvo na venda ou com os custos registrados nos itens." : `${profitData.incomplete} venda(s) sem lucro salvo e sem custo completo nos itens foram excluídas do cálculo do lucro bruto. O faturamento continua incluído.`}</p>
            </div>
            <div className="mt-3 rounded-xl border border-border bg-secondary/30 p-3">
              <div className="text-sm font-semibold text-foreground">Despesas operacionais</div>
              <p className="mt-1 text-sm text-muted-foreground">Ainda não estão incluídas neste resultado. Vamos auditar e integrar essa parte na próxima etapa, sem estimar valores.</p>
            </div>
            <div className="mt-3 rounded-xl border border-border bg-secondary/30 p-3">
              <div className="text-sm font-semibold text-foreground">Transferências e ajustes</div>
              <p className="mt-1 text-sm text-muted-foreground">Não são tratados como prejuízo ou baixa automática nesta primeira versão.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
