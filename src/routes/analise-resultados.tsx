import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { brl, useStore } from "@/lib/store";
import { ArrowLeft, CalendarDays, ChartNoAxesCombined, PackageMinus, ReceiptText, TrendingDown, Wallet, Banknote, CreditCard, ShoppingBag, Landmark } from "lucide-react";

export const Route = createFileRoute("/analise-resultados")({
  head: () => ({ meta: [{ title: "MobFlow — Analisar resultados da empresa" }] }),
  component: AnaliseResultados,
});

function AnaliseResultados() {
  const navigate = useNavigate();
  const sales = useStore((s) => s.sales ?? []);
  const writeoffs = useStore((s) => s.stockWriteoffs ?? []);
  const cashSessions = useStore((s) => s.cashSessions ?? []);
  const cashMovements = useStore((s) => s.cashMovements ?? []);
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
  const isInPeriod = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    const key = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    return dateMode === "month" ? key.slice(0, 7) === month : startDate <= endDate && key >= startDate && key <= endDate;
  };
  const paymentBreakdown = (["Dinheiro", "Pix", "Cartão", "Fiado"] as const).map((method) => ({
    method,
    total: filteredSales.filter((sale) => sale.payment === method).reduce((sum, sale) => sum + Number(sale.total || 0), 0),
    count: filteredSales.filter((sale) => sale.payment === method).length,
  }));
  const productPerformance = (() => {
    const map = new Map<string, { name: string; quantity: number; revenue: number; cost: number; profit: number; missingCost: number }>();
    filteredSales.forEach((sale) => {
      const grossSubtotal = (sale.items ?? []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
      const netFactor = grossSubtotal > 0 ? Number(sale.total || 0) / grossSubtotal : 1;
      (sale.items ?? []).forEach((item) => {
        const key = item.productId || item.name.trim().toLocaleLowerCase("pt-BR");
        const current = map.get(key) ?? { name: item.name, quantity: 0, revenue: 0, cost: 0, profit: 0, missingCost: 0 };
        const quantity = Number(item.qty || 0);
        const revenueValue = Number(item.price || 0) * quantity * netFactor;
        current.quantity += quantity;
        current.revenue += revenueValue;
        if (typeof item.cost === "number" && Number.isFinite(item.cost)) {
          const costValue = item.cost * quantity;
          current.cost += costValue;
          current.profit += revenueValue - costValue;
        } else {
          current.missingCost += 1;
        }
        map.set(key, current);
      });
    });
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  })();
  const fiadoPayments = filteredSales.filter((sale) => sale.payment === "Fiado").flatMap((sale) =>
    (sale.payments ?? (sale.paid && sale.paidAt ? [{ value: sale.total, date: sale.paidAt }] : []))
      .filter((payment) => isInPeriod(payment.date))
      .map((payment) => ({ ...payment, customer: sale.customer || "Cliente não informado", saleId: sale.id }))
  );
  const fiadoReceived = fiadoPayments.reduce((sum, payment) => sum + Number(payment.value || 0), 0);
  const fiadoOutstanding = filteredSales.filter((sale) => sale.payment === "Fiado").reduce((sum, sale) => {
    const paid = (sale.payments ?? (sale.paid ? [{ value: sale.total, date: sale.paidAt ?? sale.date }] : [])).reduce((value, payment) => value + Number(payment.value || 0), 0);
    return sum + Math.max(0, Number(sale.total || 0) - paid);
  }, 0);
  const periodCashMovements = cashMovements.filter((movement) => isInPeriod(movement.date));
  const cashWithdrawals = periodCashMovements.filter((movement) => movement.type === "sangria").reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const cashAdditions = periodCashMovements.filter((movement) => movement.type === "reforco").reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const periodCashSessions = cashSessions.filter((session) => isInPeriod(session.openedAt));
  const cashDifferences = periodCashSessions.filter((session) => session.status === "closed" && typeof session.difference === "number");
  const cashDifferenceTotal = cashDifferences.reduce((sum, session) => sum + Number(session.difference || 0), 0);
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

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="glass p-4 md:p-5">
            <div className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-primary" /><h2 className="font-display text-lg text-heading">Vendas por forma de pagamento</h2></div>
            <p className="mb-3 text-sm text-muted-foreground">Valor das vendas registradas no período, incluindo fiado ainda não recebido.</p>
            <div className="divide-y divide-border">
              {paymentBreakdown.map((item) => <div key={item.method} className="flex items-center justify-between gap-3 py-3"><div><div className="font-semibold text-foreground">{item.method}</div><div className="text-xs text-muted-foreground">{item.count} venda(s)</div></div><div className="font-semibold tabular-nums text-foreground">{money(item.total)}</div></div>)}
            </div>
          </div>
          <div className="glass p-4 md:p-5">
            <div className="flex items-center gap-2"><Banknote className="h-5 w-5 text-primary" /><h2 className="font-display text-lg text-heading">Fiado e recebimentos</h2></div>
            <p className="mb-3 text-sm text-muted-foreground">Separação entre compras feitas no fiado e dinheiro efetivamente recebido.</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Recebido no período</span><strong className="tabular-nums text-foreground">{money(fiadoReceived)}</strong></div>
              <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Saldo pendente das vendas do período</span><strong className="tabular-nums text-orange-600">{money(fiadoOutstanding)}</strong></div>
              <p className="rounded-lg border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">Os recebimentos são filtrados pela data de cada pagamento. Pagamentos de vendas antigas aparecem como recebimentos, mas não são somados novamente ao faturamento.</p>
              {fiadoPayments.length > 0 && <div className="max-h-48 divide-y divide-border overflow-y-auto">{fiadoPayments.slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((payment, index) => <div key={payment.saleId + payment.date + index} className="flex items-center justify-between gap-3 py-2 text-sm"><div className="min-w-0"><div className="truncate font-medium text-foreground">{payment.customer}</div><div className="text-xs text-muted-foreground">{new Date(payment.date).toLocaleDateString("pt-BR")}</div></div><strong className="shrink-0 tabular-nums">{money(payment.value)}</strong></div>)}</div>}
            </div>
          </div>
        </section>

        <section className="glass p-4 md:p-5">
          <div className="flex items-center gap-2"><ShoppingBag className="h-5 w-5 text-primary" /><h2 className="font-display text-lg text-heading">Desempenho dos produtos</h2></div>
          <p className="mb-3 text-sm text-muted-foreground">Produtos ordenados pelo faturamento. O lucro por produto usa o custo salvo no item da venda e distribui descontos proporcionalmente.</p>
          {productPerformance.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhum produto vendido no período.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Produto</th><th className="py-2 px-2 text-right">Qtd.</th><th className="py-2 px-2 text-right">Faturamento</th><th className="py-2 px-2 text-right">Custo</th><th className="py-2 pl-2 text-right">Lucro calculável</th></tr></thead><tbody>{productPerformance.map((item) => <tr key={item.name} className="border-b border-border/60 last:border-0"><td className="py-3 pr-3 font-medium text-foreground">{item.name}{item.missingCost > 0 && <div className="text-xs font-normal text-orange-600">Custo ausente em {item.missingCost} item(ns) de venda</div>}</td><td className="px-2 py-3 text-right tabular-nums">{item.quantity}</td><td className="px-2 py-3 text-right tabular-nums">{money(item.revenue)}</td><td className="px-2 py-3 text-right tabular-nums">{money(item.cost)}</td><td className="py-3 pl-2 text-right font-semibold tabular-nums">{item.missingCost > 0 ? "Incompleto" : money(item.profit)}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="glass p-4 md:p-5">
            <div className="flex items-center gap-2"><Landmark className="h-5 w-5 text-primary" /><h2 className="font-display text-lg text-heading">Movimentações de caixa</h2></div>
            <p className="mb-3 text-sm text-muted-foreground">Sangrias e reforços registrados no período.</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Reforços</span><strong className="text-foreground">{money(cashAdditions)}</strong></div>
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Sangrias</span><strong className="text-destructive">{money(cashWithdrawals)}</strong></div>
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Caixas abertos no período</span><strong className="text-foreground">{periodCashSessions.length}</strong></div>
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Diferença acumulada dos caixas fechados</span><strong className={cashDifferenceTotal < 0 ? "text-destructive" : "text-foreground"}>{money(cashDifferenceTotal)}</strong></div>
              <p className="rounded-lg border border-border bg-secondary/30 p-3 text-xs text-muted-foreground">Sangrias e reforços são movimentações de caixa, não despesas operacionais ou vendas. A diferença do caixa é exibida separadamente.</p>
            </div>
          </div>
          <div className="glass p-4 md:p-5">
            <div className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-primary" /><h2 className="font-display text-lg text-heading">O que ainda não entra no resultado</h2></div>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>Despesas operacionais: o estado atual do PDV não possui um cadastro estruturado de despesas para somar com segurança.</p>
              <p>Taxas de cartão e Pix: não são descontadas porque não há registro confiável das taxas efetivamente cobradas.</p>
              <p>Transferências de estoque: não são prejuízo; representam mudança de destino do produto.</p>
              <p>Por isso, o resultado após baixas continua sendo lucro bruto menos baixas registradas, e não lucro líquido.</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
