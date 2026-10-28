import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { useStore, type StockMovement } from "@/lib/store";
import { ArrowLeft, ChevronDown, Filter, History, TrendingDown, TrendingUp, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/movimentacoes-estoque")({
  head: () => ({ meta: [{ title: "MobFlow — Movimentações de estoque" }] }),
  component: MovimentacoesEstoque,
});

function MovimentacoesEstoque() {
  const navigate = useNavigate();
  const movements = useStore((s) => s.stockMovements ?? []);
  const [operation, setOperation] = useState("Todas");
  const [direction, setDirection] = useState("Todas");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<StockMovement | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const operationTypes = useMemo(() => [...new Set(movements.map((m) => m.type))].sort((a, b) => a.localeCompare(b, "pt-BR")), [movements]);
  const filtered = useMemo(() => movements
    .filter((m) => operation === "Todas" || m.type === operation)
    .filter((m) => direction === "Todas" || (direction === "Entradas" ? m.delta > 0 : direction === "Saídas" ? m.delta < 0 : m.delta === 0))
    .filter((m) => !fromDate || new Date(m.date).toISOString().slice(0, 10) >= fromDate)
    .filter((m) => !toDate || new Date(m.date).toISOString().slice(0, 10) <= toDate)
    .filter((m) => !search.trim() || `${m.productName} ${m.productCode ?? ""} ${m.operator ?? ""} ${m.details ?? ""}`.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [movements, operation, direction, fromDate, toDate, search]);

  const clearFilters = () => { setOperation("Todas"); setDirection("Todas"); setFromDate(""); setToDate(""); setSearch(""); };
  const formatMoney = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
  const formatQuantity = (value: number, unit: "un" | "kg") => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value)} ${unit}`;
  const formatDate = (value: string, seconds = false) => `${new Date(value).toLocaleDateString("pt-BR")} ${new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) })}`;

  return (
    <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
      <AppHeader />
      <main className="mx-auto max-w-6xl space-y-5 pt-16">
        <button type="button" onClick={() => navigate({ to: "/operacoes" })} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 font-semibold text-heading hover:bg-muted">
          <ArrowLeft className="h-4 w-4" /> Voltar para Operações
        </button>

        <section className="rounded-2xl bg-white p-5 ring-1 ring-border md:p-7">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-green-600/10 text-green-700"><History className="h-6 w-6" /></div>
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold text-heading md:text-3xl">Movimentações de estoque</h1>
              <p className="mt-1 text-sm text-muted-foreground">Consulte entradas, saídas e ajustes registrados no estoque.</p>
            </div>
          </div>}
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-border md:p-6">
          <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} className="mb-4 flex w-full items-center justify-between gap-2 font-bold text-heading"><span className="inline-flex items-center gap-2"><Filter className="h-5 w-5" /> Filtrar movimentações</span><ChevronDown className={`h-5 w-5 transition-transform ${filtersOpen ? "rotate-180" : ""}`} /></button>
          {filtersOpen && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1.5 text-sm font-medium text-heading">Operação
              <select value={operation} onChange={(e) => setOperation(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
                <option value="Todas">Todas as operações</option>
                {operationTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-heading">Movimento
              <select value={direction} onChange={(e) => setDirection(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
                <option value="Todas">Entradas e saídas</option><option value="Entradas">Somente entradas</option><option value="Saídas">Somente saídas</option><option value="Sem alteração">Sem alteração de saldo</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-heading">Produto, código ou operador
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Digite para pesquisar" className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm" />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-heading">Data inicial
              <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm" />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-heading">Data final
              <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm" />
            </label>
            <div className="flex items-end"><button type="button" onClick={clearFilters} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 font-semibold hover:bg-muted"><X className="h-4 w-4" /> Limpar filtros</button></div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-border md:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-heading">Histórico</h2>
            <span className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-muted-foreground">{filtered.length} de {movements.length} registro(s)</span>
          </div>
          {filtered.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{movements.length === 0 ? "Ainda não há movimentações registradas para esta empresa." : "Nenhum registro corresponde aos filtros selecionados."}</div> : <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="whitespace-nowrap">Data e hora</TableHead><TableHead>Operação</TableHead><TableHead>Produto</TableHead><TableHead className="whitespace-nowrap text-right">Quantidade</TableHead><TableHead className="whitespace-nowrap text-right">Valor total</TableHead><TableHead className="whitespace-nowrap text-right">Estoque antes</TableHead><TableHead className="whitespace-nowrap text-right">Estoque depois</TableHead><TableHead className="whitespace-nowrap text-right">Variação</TableHead>
              </TableRow></TableHeader>
              <TableBody>{filtered.map((m) => <TableRow key={m.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelected(m)}>
                <TableCell className="whitespace-nowrap">{formatDate(m.date)}</TableCell>
                <TableCell className="whitespace-nowrap">{m.type}</TableCell>
                <TableCell className="min-w-40"><div className="font-medium">{m.productName}</div>{m.productCode && <div className="text-xs text-muted-foreground">Cód. {m.productCode}</div>}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{formatQuantity(m.quantity, m.unit)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{formatMoney(m.totalValue)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{formatQuantity(m.stockBefore, m.unit)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold">{formatQuantity(m.stockAfter, m.unit)}</TableCell>
                <TableCell className={`whitespace-nowrap text-right font-bold ${m.delta > 0 ? "text-green-700" : m.delta < 0 ? "text-red-600" : "text-muted-foreground"}`}>{m.delta > 0 ? "+" : ""}{formatQuantity(m.delta, m.unit)} {m.delta > 0 ? <TrendingUp className="ml-1 inline h-4 w-4" /> : m.delta < 0 ? <TrendingDown className="ml-1 inline h-4 w-4" /> : null}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </div>}
        </section>

        <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            {selected && <>
              <DialogHeader><DialogTitle>Detalhes da movimentação</DialogTitle><DialogDescription>Registro individual para consulta.</DialogDescription></DialogHeader>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Data e hora</p><p className="mt-1 font-semibold">{formatDate(selected.date, true)}</p></div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Tipo de operação</p><p className="mt-1 font-semibold">{selected.type}</p></div>
                <div className="rounded-lg bg-muted/40 p-3 sm:col-span-2"><p className="text-xs text-muted-foreground">Produto</p><p className="mt-1 font-semibold">{selected.productName}</p>{selected.productCode && <p className="text-sm text-muted-foreground">Código: {selected.productCode}</p>}</div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Quantidade movimentada</p><p className="mt-1 font-semibold">{formatQuantity(selected.quantity, selected.unit)}</p></div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Valor total</p><p className="mt-1 font-semibold">{formatMoney(selected.totalValue)}</p></div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Estoque antes</p><p className="mt-1 font-semibold">{formatQuantity(selected.stockBefore, selected.unit)}</p></div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Estoque depois</p><p className="mt-1 font-semibold">{formatQuantity(selected.stockAfter, selected.unit)}</p></div>
                <div className="rounded-lg border p-3 sm:col-span-2"><p className="text-xs text-muted-foreground">Variação final</p><p className={`mt-1 text-lg font-extrabold ${selected.delta > 0 ? "text-green-700" : selected.delta < 0 ? "text-red-600" : "text-muted-foreground"}`}>{selected.delta > 0 ? "+" : ""}{formatQuantity(selected.delta, selected.unit)}</p></div>
                {selected.operator && <div className="rounded-lg bg-muted/40 p-3 sm:col-span-2"><p className="text-xs text-muted-foreground">Operador</p><p className="mt-1 font-semibold">{selected.operator}</p></div>}
                {selected.details && <div className="rounded-lg bg-muted/40 p-3 sm:col-span-2"><p className="text-xs text-muted-foreground">Referência</p><p className="mt-1 text-sm">{selected.details}</p></div>}
                <div className="text-xs text-muted-foreground sm:col-span-2">Identificador: {selected.operationId}</div>
              </div>
            </>}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
