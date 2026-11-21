import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { brl, useStore } from "@/lib/store";
import { ArrowLeft, CalendarDays, ChartNoAxesCombined, PackageMinus, ReceiptText, TrendingDown, Wallet, Banknote, CreditCard, ShoppingBag, Landmark, FileSpreadsheet, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/analise-resultados")({
  head: () => ({ meta: [{ title: "MobFlow — Analisar resultados da empresa" }] }),
  component: AnaliseResultados,
});

function AnaliseResultados() {
  const navigate = useNavigate();
  const sales = useStore((s) => s.sales ?? []);
  const writeoffs = useStore((s) => s.stockWriteoffs ?? []);
  const stockTransfers = useStore((s) => s.stockTransfers ?? []);
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
  const filteredTransfers = useMemo(() => stockTransfers.filter((transfer) => {
    const date = new Date(transfer.date);
    if (Number.isNaN(date.getTime())) return false;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return dateMode === "month" ? key.slice(0, 7) === month : startDate <= endDate && key >= startDate && key <= endDate;
  }), [stockTransfers, dateMode, month, startDate, endDate]);
  const transferTotal = filteredTransfers.reduce((sum, transfer) => sum + (transfer.items ?? []).reduce((itemSum, item) => itemSum + Number(item.totalCost || 0), 0), 0);
  const transferQuantity = filteredTransfers.reduce((sum, transfer) => sum + (transfer.items ?? []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0);
  // Soma somente o desconto explícito gravado no checkout da venda.
  // Não infere desconto pela diferença entre subtotal e total, evitando contar ajustes
  // ou valores de operações que não sejam descontos efetivamente aplicados no PDV.
  const discountTotal = filteredSales.reduce((sum, sale) => sum + Math.max(0, Number(sale.discount || 0)), 0);
  const transferDestinations = Array.from(filteredTransfers.reduce((map, transfer) => {
    const key = transfer.destinationName || "Destino não informado";
    const current = map.get(key) ?? { destination: key, count: 0, total: 0, quantity: 0 };
    current.count += 1;
    current.total += (transfer.items ?? []).reduce((itemSum, item) => itemSum + Number(item.totalCost || 0), 0);
    current.quantity += (transfer.items ?? []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0);
    map.set(key, current);
    return map;
  }, new Map<string, { destination: string; count: number; total: number; quantity: number }>()).values()).sort((a, b) => b.total - a.total);
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
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  })();
  const fiadoPayments = sales.filter((sale) => sale.payment === "Fiado").flatMap((sale) =>
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


  const trendEnd = dateMode === "month" ? new Date(month + "-01T12:00:00") : new Date(endDate + "T12:00:00");
  const monthlyWriteoffTrend = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(trendEnd.getFullYear(), trendEnd.getMonth() - 5 + index, 1, 12);
    const monthEntries = writeoffs.filter((entry) => {
      const entryDate = new Date(entry.date);
      return !Number.isNaN(entryDate.getTime()) && entryDate.getFullYear() === date.getFullYear() && entryDate.getMonth() === date.getMonth();
    });
    const totalForReason = (reason: "Perda" | "Consumo" | "Doação") =>
      monthEntries.filter((entry) => entry.reason === reason).reduce(
        (sum, entry) => sum + (entry.items ?? []).reduce((itemsSum, item) => itemsSum + Number(item.totalCost || 0), 0), 0
      );
    return {
      month: date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
      perda: totalForReason("Perda"),
      consumo: totalForReason("Consumo"),
      doacao: totalForReason("Doação"),
    };
  });
  const monthlyTrend = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(trendEnd.getFullYear(), trendEnd.getMonth() - 5 + index, 1, 12);
    const monthSales = sales.filter((sale) => {
      const saleDate = new Date(sale.date);
      return !Number.isNaN(saleDate.getTime()) && saleDate.getFullYear() === date.getFullYear() && saleDate.getMonth() === date.getMonth();
    });
    const revenue = monthSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    return { month: date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), revenue };
  });
  const monthlyPaymentTrend = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(trendEnd.getFullYear(), trendEnd.getMonth() - 5 + index, 1, 12);
    const monthSales = sales.filter((sale) => {
      const saleDate = new Date(sale.date);
      return !Number.isNaN(saleDate.getTime()) && saleDate.getFullYear() === date.getFullYear() && saleDate.getMonth() === date.getMonth();
    });
    const totalForMethod = (method: "Dinheiro" | "Pix" | "Cartão" | "Fiado") =>
      monthSales.filter((sale) => sale.payment === method).reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    return {
      month: date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
      dinheiro: totalForMethod("Dinheiro"),
      pix: totalForMethod("Pix"),
      cartao: totalForMethod("Cartão"),
      fiado: totalForMethod("Fiado"),
    };
  });
  const topProductsByQuantity = [...productPerformance].sort((a, b) => b.quantity - a.quantity).slice(0, 10);
  const exportExcel = () => {
    const workbook = XLSX.utils.book_new();
    const summary = [
      ["Relatório de resultados MobFlow"], ["Período", periodLabel],
      ["Faturamento em vendas", revenue], ["Lucro bruto registrado", profitData.total],
      ["Custo das baixas", writeoffTotal], ["Resultado após baixas", resultAfterWriteoffs],
      ["Descontos concedidos nas vendas", discountTotal], ["Valor transferido (custo registrado)", transferTotal], ["Quantidade transferida", transferQuantity],
      ["Recebimentos de fiado no período", fiadoReceived], ["Saldo pendente das vendas do período", fiadoOutstanding],
      ["Reforços de caixa", cashAdditions], ["Sangrias de caixa", cashWithdrawals],
      ["Diferença acumulada dos caixas fechados", cashDifferenceTotal],
      ["Observação", "Despesas operacionais e taxas não incluídas por falta de registros estruturados."]
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), "Resumo");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filteredSales.map((sale) => ({
      Data: sale.date, Venda: sale.id, Cliente: sale.customer || "", Pagamento: sale.payment || "",
      Faturamento: Number(sale.total || 0), LucroRegistrado: typeof sale.profit === "number" ? sale.profit : null,
      Itens: (sale.items ?? []).map((item) => item.name + " x" + item.qty).join("; ")
    }))), "Vendas");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filteredTransfers.flatMap((transfer) => (transfer.items ?? []).map((item) => ({
      Data: transfer.date, Numero: transfer.number, Destino: transfer.destinationName, Operador: transfer.operator || "",
      Produto: item.name, Quantidade: item.quantity, CustoUnitario: item.unitCost, ValorTransferido: item.totalCost
    })))), "Transferências");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(filteredWriteoffs.flatMap((entry) => (entry.items ?? []).map((item) => ({
      Data: entry.date, Motivo: entry.reason, Produto: item.name, Quantidade: item.qty,
      CustoUnitario: item.cost, CustoTotal: item.totalCost
    })))), "Baixas");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(productPerformance.map((item) => ({
      Produto: item.name, QuantidadeVendida: item.quantity, Faturamento: item.revenue,
      CustoCalculado: item.cost, LucroCalculavel: item.missingCost ? null : item.profit,
      ItensSemCusto: item.missingCost
    }))), "Produtos");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(paymentBreakdown.map((item) => ({
      FormaPagamento: item.method, Vendas: item.count, Faturamento: item.total
    }))), "Formas de pagamento");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(fiadoPayments.map((payment) => ({
      DataRecebimento: payment.date, Cliente: payment.customer, Venda: payment.saleId, ValorRecebido: payment.value
    }))), "Recebimentos fiado");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(periodCashMovements.map((movement) => ({
      Data: movement.date, Tipo: movement.type, Valor: movement.amount
    }))), "Movimentações caixa");
    XLSX.writeFile(workbook, "mobflow-resultados-" + todayKey + ".xlsx");
  };

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
            <button type="button" onClick={() => navigate({ to: "/gerencia" })} className="print:hidden inline-flex items-center gap-2 rounded-xl bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground hover:bg-accent"><ArrowLeft className="h-4 w-4" />Voltar para gerência</button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 print:hidden">
            <button type="button" onClick={exportExcel} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"><FileSpreadsheet className="h-4 w-4" />Exportar Excel</button>
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-accent"><FileText className="h-4 w-4" />Salvar relatório em PDF</button>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-secondary/30 p-3 print:mt-2 print:border-0 print:bg-transparent print:px-0 print:py-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4" />Período: <strong className="capitalize text-foreground">{periodLabel}</strong></div>
            <button type="button" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} className="print:hidden rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground">{filtersOpen ? "Fechar filtros" : "Alterar período"}</button>
          </div>
          {filtersOpen && <div className="print:hidden mt-3 grid gap-3 rounded-xl border border-border bg-secondary/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-semibold text-muted-foreground">Tipo de período<select value={dateMode} onChange={(event) => setDateMode(event.target.value as "month" | "range")} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground"><option value="month">Mês</option><option value="range">Data personalizada</option></select></label>
            {dateMode === "month" ? <label className="text-xs font-semibold text-muted-foreground">Mês<input type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground" /></label> : <>
              <label className="text-xs font-semibold text-muted-foreground">Data inicial<input type="date" value={startDate} max={endDate} onChange={(event) => event.target.value && setStartDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground" /></label>
              <label className="text-xs font-semibold text-muted-foreground">Data final<input type="date" value={endDate} min={startDate} onChange={(event) => event.target.value && setEndDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground" /></label>
            </>}
            <div className="flex items-end"><button type="button" onClick={() => { setDateMode("month"); setMonth(todayKey.slice(0, 7)); setStartDate(todayKey.slice(0, 8) + "01"); setEndDate(todayKey); }} className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-accent">Voltar ao mês atual</button></div>
          </div>}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2 print:break-inside-avoid">
          <div className="glass p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><ReceiptText className="h-4 w-4" />Faturamento em vendas</div><div className="mt-2 font-display text-3xl text-primary">{money(revenue)}</div><p className="mt-1 text-xs text-muted-foreground">{filteredSales.length} venda(s) registradas</p></div>
          <div className="glass p-4"><div className="text-sm font-semibold text-muted-foreground">Descontos concedidos</div><div className="mt-2 font-display text-2xl font-bold text-foreground">{money(discountTotal)}</div></div>
          <div className="glass p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="h-4 w-4" />Lucro bruto registrado</div><div className="mt-2 font-display text-3xl text-primary">{money(profitData.total)}</div><p className="mt-1 text-xs text-muted-foreground">Antes do impacto das baixas e despesas</p></div>
          <div className="glass p-4"><div className="text-sm font-semibold text-muted-foreground">Total de transferências</div><div className="mt-2 font-display text-2xl font-bold text-foreground">{money(transferTotal)}</div><p className="mt-1 text-xs text-muted-foreground">{filteredTransfers.length} transferência(s) · {transferQuantity} unidade(s)/itens</p></div>
          <div className="glass p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground"><PackageMinus className="h-4 w-4" />Custo das baixas</div><div className="mt-2 font-display text-3xl text-destructive">{money(writeoffTotal)}</div><p className="mt-1 text-xs text-muted-foreground">{filteredWriteoffs.length} operação(ões) de baixa</p></div>
          <div className="glass rounded-xl border-2 border-black p-4 shadow-sm"><div className="flex items-center gap-2 text-sm font-bold text-foreground"><TrendingDown className="h-4 w-4" />Resultado após baixas</div><div className={`mt-2 font-display text-3xl font-extrabold ${resultAfterWriteoffs >= 0 ? "text-primary" : "text-destructive"}`}>{money(resultAfterWriteoffs)}</div><p className="mt-1 text-xs font-bold text-foreground">Lucro bruto menos custo das baixas</p></div>
        </section>

        <section className="glass p-4 md:p-5">
          <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /><h2 className="font-display text-lg text-heading">Vendas por mês</h2></div>
          <p className="mb-3 text-sm text-muted-foreground">Comparativo dos últimos seis meses até o mês do filtro.</p>
          <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthlyTrend} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 10 }} tickFormatter={(value: number) => value >= 1000 ? "R$" + (value / 1000).toFixed(1) + "k" : "R$" + value} width={54} /><Tooltip formatter={(value: number) => [money(value), "Faturamento"]} labelFormatter={(label) => "Mês: " + label} /><Bar dataKey="revenue" name="Faturamento" fill="#16a34a" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </section>

        <section className="glass space-y-5 p-4 md:p-5 print:break-inside-avoid">
          <div>
            <div className="flex items-center gap-2"><ChartNoAxesCombined className="h-5 w-5 text-primary" /><h2 className="font-display text-lg text-heading">Produtos mais vendidos</h2></div>
            <p className="mb-3 text-sm text-muted-foreground">Ranking por quantidade vendida no período selecionado.</p>
            {topProductsByQuantity.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Sem vendas para montar o gráfico.</p> : <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={topProductsByQuantity} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 11 }} tickFormatter={(value: string) => value.length > 17 ? value.slice(0, 17) + "…" : value} /><Tooltip formatter={(value: number) => [value + " un.", "Quantidade"]} /><Bar dataKey="quantity" name="Quantidade" fill="#16a34a" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div>}
          </div>
          <div className="border-t border-border pt-5">
            <div className="flex items-center gap-2"><ShoppingBag className="h-5 w-5 text-primary" /><h2 className="font-display text-lg text-heading">Desempenho dos produtos</h2></div>
            <p className="mb-3 text-sm text-muted-foreground">Produtos ordenados pelo faturamento. O lucro por produto usa o custo salvo no item da venda e distribui descontos proporcionalmente.</p>
            {productPerformance.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhum produto vendido no período.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-2 pr-3">Produto</th><th className="py-2 px-2 text-right">Qtd.</th><th className="py-2 px-2 text-right">Faturamento</th><th className="py-2 px-2 text-right">Custo</th><th className="py-2 pl-2 text-right">Lucro calculável</th></tr></thead><tbody>{productPerformance.slice(0, 10).map((item, index) => <tr key={item.name + "-" + index} className="border-b border-border/60 last:border-0"><td className="py-3 pr-3 font-medium text-foreground">{item.name}{item.missingCost > 0 && <div className="text-xs font-normal text-orange-600">Custo ausente em {item.missingCost} item(ns) de venda</div>}</td><td className="px-2 py-3 text-right tabular-nums">{item.quantity}</td><td className="px-2 py-3 text-right tabular-nums">{money(item.revenue)}</td><td className="px-2 py-3 text-right tabular-nums">{money(item.cost)}</td><td className="py-3 pl-2 text-right font-semibold tabular-nums">{item.missingCost > 0 ? "Incompleto" : money(item.profit)}</td></tr>)}</tbody></table></div>}
          </div>
        </section>

        <section className="glass p-4 md:p-5 print:break-inside-avoid">
          <h2 className="font-display text-lg text-heading">Composição das baixas</h2>
          <p className="mb-3 text-sm text-muted-foreground">Valores pelo custo registrado em cada operação.</p>
          <div className="mb-4">
            <p className="mb-3 text-sm text-muted-foreground">Comparativo mensal dos três tipos de baixa nos últimos seis meses, incluindo o mês selecionado e os cinco anteriores.</p>
            <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthlyWriteoffTrend} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 10 }} tickFormatter={(value: number) => value >= 1000 ? "R$" + (value / 1000).toFixed(1) + "k" : "R$" + value} width={54} /><Tooltip formatter={(value: number, name: string) => [money(value), name]} labelFormatter={(label) => "Mês: " + label} /><Bar dataKey="perda" name="Perda" fill="#ef4444" radius={[4, 4, 0, 0]} /><Bar dataKey="consumo" name="Consumo" fill="#f59e0b" radius={[4, 4, 0, 0]} /><Bar dataKey="doacao" name="Doação" fill="#3b82f6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
          </div>
          <div className="divide-y divide-border">
            {writeoffsByReason.map((item) => <div key={item.reason} className="flex items-center justify-between gap-3 py-3"><div><div className="font-semibold text-foreground">{item.reason}</div><div className="text-xs text-muted-foreground">{item.count} operação(ões)</div></div><div className="font-semibold tabular-nums text-foreground">{money(item.total)}</div></div>)}
            <div className="flex items-center justify-between gap-3 py-3 font-bold"><span>Total das baixas</span><span>{money(writeoffTotal)}</span></div>
          </div>
        </section>



        <section className="grid gap-4 lg:grid-cols-2">
          <div className="glass p-4 md:p-5">
            <div className="flex items-center gap-2"><Landmark className="h-5 w-5 text-primary" /><h2 className="font-display text-lg text-heading">Movimentações de caixa</h2></div>
            <p className="mb-3 text-sm text-muted-foreground">Sangrias e reforços registrados no período.</p>
            <div className="mb-4 border-b border-border pb-4">
              <h3 className="font-semibold text-foreground">Valores por forma de pagamento</h3>
              <p className="mb-3 text-xs text-muted-foreground">Comparativo dos últimos seis meses até o mês do filtro.</p>
              <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthlyPaymentTrend} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 10 }} tickFormatter={(value: number) => value >= 1000 ? "R$" + (value / 1000).toFixed(1) + "k" : "R$" + value} width={54} /><Tooltip formatter={(value: number, name: string) => [money(value), name]} labelFormatter={(label) => "Mês: " + label} /><Bar dataKey="dinheiro" name="Dinheiro" fill="#16a34a" radius={[4, 4, 0, 0]} /><Bar dataKey="pix" name="Pix" fill="#0ea5e9" radius={[4, 4, 0, 0]} /><Bar dataKey="cartao" name="Cartão" fill="#8b5cf6" radius={[4, 4, 0, 0]} /><Bar dataKey="fiado" name="Fiado" fill="#f59e0b" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {paymentBreakdown.map((item) => <div key={item.method} className="rounded-lg bg-secondary/40 p-3"><div className="flex items-center gap-2 text-xs text-muted-foreground"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.method === "Dinheiro" ? "bg-[#16a34a]" : item.method === "Pix" ? "bg-[#0ea5e9]" : item.method === "Cartão" ? "bg-[#8b5cf6]" : "bg-[#f59e0b]"}`} />{item.method}</div><div className="mt-1 font-semibold tabular-nums text-foreground">{money(item.total)}</div></div>)}
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Reforços</span><strong className="text-foreground">{money(cashAdditions)}</strong></div>
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Sangrias</span><strong className="text-destructive">{money(cashWithdrawals)}</strong></div>
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Caixas abertos no período</span><strong className="text-foreground">{periodCashSessions.length}</strong></div>
              <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Diferença acumulada dos caixas fechados</span><strong className={cashDifferenceTotal < 0 ? "text-destructive" : "text-foreground"}>{money(cashDifferenceTotal)}</strong></div>
              
            </div>
          </div>

        </section>
      </main>
    </div>
  );
}
