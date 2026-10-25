import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Wallet, History, Filter } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { brl, useStore } from "@/lib/store";

export const Route = createFileRoute("/operacao-caixa")({
  head: () => ({ meta: [{ title: "MobFlow — Operação de caixa" }, { name: "description", content: "Histórico de abertura, fechamento e movimentações de caixa." }] }),
  component: OperacaoCaixa,
});

function OperacaoCaixa() {
  const cashSessions = useStore((s) => s.cashSessions ?? []);
  const cashMovements = useStore((s) => s.cashMovements ?? []);
  const [expandedCashSessions, setExpandedCashSessions] = useState<string[]>([]);
  const today = new Date();
  const todayKey = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  const [cashOperatorFilter, setCashOperatorFilter] = useState("todos");
  const [dateFilterMode, setDateFilterMode] = useState<"month" | "range">("month");
  const [selectedMonth, setSelectedMonth] = useState(todayKey.slice(0, 7));
  const [rangeStart, setRangeStart] = useState(todayKey);
  const [rangeEnd, setRangeEnd] = useState(todayKey);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const navigate = useNavigate();
  useEffect(() => { if (sessionStorage.getItem("mobflow-management") !== "1") navigate({ to: "/gerencia" }); }, [navigate]);
  const cashOperators = useMemo(() => Array.from(new Set(cashSessions.flatMap(session => [session.openedBy, session.closedBy].filter(Boolean) as string[])).values()).sort((a, b) => a.localeCompare(b, "pt-BR")), [cashSessions]);
  const filteredCashSessions = useMemo(() => cashSessions.filter(session => {
    const date = new Date(session.openedAt);
    const key = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    const inPeriod = dateFilterMode === "month" ? key.slice(0, 7) === selectedMonth : rangeStart <= rangeEnd && key >= rangeStart && key <= rangeEnd;
    const matchesOperator = cashOperatorFilter === "todos" || session.openedBy === cashOperatorFilter || session.closedBy === cashOperatorFilter;
    return inPeriod && matchesOperator;
  }).sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()), [cashSessions, cashOperatorFilter, dateFilterMode, selectedMonth, rangeStart, rangeEnd]);
  return <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader /><section className="glass p-4 md:p-6">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Wallet className="h-5 w-5" /></div><div><h1 className="font-display text-xl text-heading">Operação de caixa</h1><p className="text-sm text-muted-foreground">Histórico de aberturas, fechamentos, sangrias e reforços.</p></div></div><button onClick={() => navigate({ to: "/vendas" })} className="rounded-xl bg-secondary px-4 py-2 text-sm text-secondary-foreground hover:bg-accent">← Voltar</button></div>
    <div className="rounded-xl border border-border bg-secondary/20 p-3 sm:p-4">
      <div className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><History className="h-5 w-5" /></div><div><h2 className="font-display text-lg text-heading">Histórico de operação de caixa</h2></div></div>
          <button type="button" onClick={() => setFiltersOpen(open => !open)} aria-expanded={filtersOpen} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground hover:bg-accent"><Filter className="h-4 w-4" />{filtersOpen ? "Fechar" : "Filtrar"}</button>
        </div>
      </div>
      {filtersOpen && <div className="mb-4 grid gap-3 rounded-xl border border-border bg-secondary/30 p-3 sm:grid-cols-2 xl:grid-cols-3">
        <label className="text-xs font-medium text-muted-foreground">Operador<select value={cashOperatorFilter} onChange={e => setCashOperatorFilter(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="todos">Todos os operadores</option>{cashOperators.map(operator => <option key={operator} value={operator}>{operator}</option>)}</select></label>
        <label className="text-xs font-medium text-muted-foreground">Filtrar por data<select value={dateFilterMode} onChange={e => setDateFilterMode(e.target.value as "month" | "range")} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="month">Mês</option><option value="range">Data personalizada</option></select></label>
        {dateFilterMode === "month" ? <label className="text-xs font-medium text-muted-foreground">Selecionar mês<input type="month" value={selectedMonth} onChange={e => e.target.value && setSelectedMonth(e.target.value)} className="mt-1 block w-full cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" /></label> : <>
          <label className="text-xs font-medium text-muted-foreground">Data inicial<input type="date" value={rangeStart} max={rangeEnd} onChange={e => e.target.value && setRangeStart(e.target.value)} className="mt-1 block w-full cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" /></label>
          <label className="text-xs font-medium text-muted-foreground">Data final<input type="date" value={rangeEnd} min={rangeStart} onChange={e => e.target.value && setRangeEnd(e.target.value)} className="mt-1 block w-full cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" /></label>
        </>}
        <div className="flex items-end"><button type="button" onClick={() => { setCashOperatorFilter("todos"); setDateFilterMode("month"); setSelectedMonth(todayKey.slice(0, 7)); setRangeStart(todayKey); setRangeEnd(todayKey); }} className="rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-accent">Limpar filtros</button></div>
      </div>}
      <div className="space-y-2">{filteredCashSessions.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma abertura de caixa encontrada.</p>}
        {filteredCashSessions.map(session => { const expanded = expandedCashSessions.includes(session.id); const movements = cashMovements.filter(m => m.sessionId === session.id).sort((a,b) => new Date(a.date).getTime()-new Date(b.date).getTime()); const withdrawals = movements.filter(m => m.type === "sangria").reduce((sum,m) => sum+m.amount,0); const additions = movements.filter(m => m.type === "reforco").reduce((sum,m) => sum+m.amount,0); return <div key={session.id} className="overflow-hidden rounded-lg border border-border/70 bg-background/60"><button type="button" onClick={() => setExpandedCashSessions(current => expanded ? current.filter(id => id !== session.id) : [...current, session.id])} aria-expanded={expanded} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-secondary/40"><div className="min-w-0"><div className="font-semibold text-foreground">{new Date(session.openedAt).toLocaleString("pt-BR", {dateStyle:"short",timeStyle:"short"})} · {session.openedBy || "Operador não registrado"}</div><div className="mt-1 text-xs text-muted-foreground">{session.status === "closed" ? `Fechado em ${session.closedAt ? new Date(session.closedAt).toLocaleString("pt-BR", {dateStyle:"short",timeStyle:"short"}) : "—"}` : "Caixa ainda aberto"} · {session.status === "closed" ? "Finalizado" : "Em andamento"}</div></div><ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} /></button>{expanded && <div className="grid gap-3 border-t border-border/70 p-3 sm:grid-cols-2 lg:grid-cols-3"><div><div className="text-xs text-muted-foreground">Data inicial</div><div className="font-medium text-foreground">{new Date(session.openedAt).toLocaleString("pt-BR")}</div></div><div><div className="text-xs text-muted-foreground">Data final</div><div className="font-medium text-foreground">{session.closedAt ? new Date(session.closedAt).toLocaleString("pt-BR") : "Ainda aberto"}</div></div><div><div className="text-xs text-muted-foreground">Operador</div><div className="font-medium text-foreground">{session.openedBy || "—"}{session.closedBy && session.closedBy !== session.openedBy ? ` / fechamento: ${session.closedBy}` : ""}</div></div><div><div className="text-xs text-muted-foreground">Saldo inicial</div><div className="font-semibold text-foreground">R$ {brl(session.openingAmount)}</div></div><div><div className="text-xs text-muted-foreground">Sangria / reforço</div><div className="font-medium text-foreground">− R$ {brl(withdrawals)} / + R$ {brl(additions)}</div></div><div><div className="text-xs text-muted-foreground">Saldo final</div><div className="font-semibold text-foreground">{session.status === "closed" ? `R$ ${brl(session.countedCash ?? 0)}` : "—"}</div></div><div><div className="text-xs text-muted-foreground">Diferença</div><div className={`font-semibold ${((session.difference ?? 0) < 0) ? "text-destructive" : "text-primary"}`}>{session.status === "closed" ? `R$ ${brl(session.difference ?? 0)}` : "—"}</div></div><div className="sm:col-span-2 lg:col-span-3 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-border/60 p-3"><div className="mb-2 text-sm font-semibold text-destructive">Sangria</div>{movements.filter(m => m.type === "sangria").length ? <div className="space-y-2">{movements.filter(m => m.type === "sangria").map(m => <div key={m.id} className="border-b border-border/40 pb-2 last:border-0 last:pb-0"><div className="font-semibold text-destructive">− R$ {brl(m.amount)} <span className="font-normal text-foreground">/ {m.reason}</span></div><div className="mt-1 text-xs text-muted-foreground">{new Date(m.date).toLocaleString("pt-BR")} · {m.operator}</div></div>)}</div> : <p className="text-sm text-muted-foreground">Nenhuma sangria registrada.</p>}</div><div className="rounded-lg border border-border/60 p-3"><div className="mb-2 text-sm font-semibold text-primary">Reforço</div>{movements.filter(m => m.type === "reforco").length ? <div className="space-y-2">{movements.filter(m => m.type === "reforco").map(m => <div key={m.id} className="border-b border-border/40 pb-2 last:border-0 last:pb-0"><div className="font-semibold text-primary">+ R$ {brl(m.amount)} <span className="font-normal text-foreground">/ {m.reason}</span></div><div className="mt-1 text-xs text-muted-foreground">{new Date(m.date).toLocaleString("pt-BR")} · {m.operator}</div></div>)}</div> : <p className="text-sm text-muted-foreground">Nenhum reforço registrado.</p>}</div></div></div>}</div>})}
      </div>
    </div>
  </section></div>;
}
