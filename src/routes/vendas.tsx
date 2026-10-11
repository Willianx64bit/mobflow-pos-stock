import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  const [dateFilterMode, setDateFilterMode] = useState<"month" | "range">("month");
  const todayKey = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0");
  const [selectedMonth, setSelectedMonth] = useState(todayKey.slice(0, 7));
  const [rangeStart, setRangeStart] = useState(todayKey);
  const [rangeEnd, setRangeEnd] = useState(todayKey);
  const navigate = useNavigate();
  useEffect(() => {
    if (sessionStorage.getItem("mobflow-management") !== "1") navigate({ to: "/gerencia" });
  }, [navigate]);
  const today = new Date().toDateString();
  const todays = sales.filter((s) => new Date(s.date).toDateString() === today);
  const sum = (arr: typeof sales) => arr.reduce((t, s) => t + s.total, 0);
  const byPay = (["Dinheiro", "Cartão", "Pix"] as const).map((m) => [m, sum(todays.filter((s) => s.payment === m))] as const);
  const filteredSales = useMemo(() => sales.filter((s) => {
    const d = new Date(s.date);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    if (dateFilterMode === "month") return key.slice(0, 7) === selectedMonth;
    return rangeStart <= rangeEnd && key >= rangeStart && key <= rangeEnd;
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [sales, dateFilterMode, selectedMonth, rangeStart, rangeEnd]);
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
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div><div className="label-mono">Histórico de vendas</div><p className="text-sm text-muted-foreground mt-1">Filtre por mês ou escolha um intervalo de datas.</p></div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-muted-foreground">Filtrar por
              <select value={dateFilterMode} onChange={(e) => setDateFilterMode(e.target.value as "month" | "range")} className="mt-1 block rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
                <option value="month">Mês</option><option value="range">Período personalizado</option>
              </select>
            </label>
            {dateFilterMode === "month" ? (
              <label className="text-xs font-medium text-muted-foreground">Selecionar mês
                <input type="month" aria-label="Selecionar mês" value={selectedMonth} onChange={(e) => e.target.value && setSelectedMonth(e.target.value)} className="mt-1 block cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
              </label>
            ) : (
              <>
                <label className="text-xs font-medium text-muted-foreground">Data inicial
                  <input type="date" aria-label="Data inicial" value={rangeStart} max={rangeEnd} onChange={(e) => e.target.value && setRangeStart(e.target.value)} className="mt-1 block cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
                </label>
                <label className="text-xs font-medium text-muted-foreground">Data final
                  <input type="date" aria-label="Data final" value={rangeEnd} min={rangeStart} onChange={(e) => e.target.value && setRangeEnd(e.target.value)} className="mt-1 block cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
                </label>
              </>
            )}
          </div>
        </div>
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
              <button onClick={() => printReceipt(s)} className="font-mono text-[11px] rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground hover:text-foreground">🧾 comprovante</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
