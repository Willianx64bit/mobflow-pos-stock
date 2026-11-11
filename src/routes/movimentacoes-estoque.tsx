import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createRealtimeClient, type SealedLiveQuery } from "@neon/realtime/client";
import { AppHeader } from "@/components/AppHeader";
import { useStore, type StockMovement } from "@/lib/store";
import { ArrowLeft, ChevronDown, Filter, History, TrendingDown, TrendingUp, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/movimentacoes-estoque")({
  head: () => ({ meta: [{ title: "MobFlow — Movimentações de estoque" }] }),
  component: MovimentacoesEstoque,
});

function localDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

type LiveMovementRow = {
  id: string; operationId: string; date: Date | string; type: string; productId: string;
  productCode: string | null; productName: string; unit: string; quantity: string | number;
  totalValue: string | number; stockBefore: string | number; stockAfter: string | number;
  delta: string | number; operator: string | null; details: string | null;
};

function mapLiveMovement(row: LiveMovementRow): StockMovement {
  const labels: Record<string, string> = {
    sale: "Venda", transfer: "Transferência", writeoff: "Baixa",
    adjustment: "Ajuste de estoque", manual_adjustment: "Ajuste manual",
    receiving: "Recebimento", receipt: "Recebimento", entry: "Entrada",
  };
  return {
    id: row.id, operationId: row.operationId, date: new Date(row.date).toISOString(),
    type: labels[row.type] ?? row.type, productId: row.productId,
    productCode: row.productCode ?? undefined, productName: row.productName,
    unit: row.unit === "kg" ? "kg" : "un", quantity: Number(row.quantity),
    totalValue: Number(row.totalValue), stockBefore: Number(row.stockBefore),
    stockAfter: Number(row.stockAfter), delta: Number(row.delta),
    operator: row.operator ?? undefined, details: row.details ?? undefined,
  };
}

function MovimentacoesEstoque() {
  const navigate = useNavigate();
  const cachedMovements = useStore((s) => s.stockMovements ?? []);
  const [liveMovements, setLiveMovements] = useState<StockMovement[] | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [realtimeError, setRealtimeError] = useState("");

  useEffect(() => {
    let stopped = false;
    let client: ReturnType<typeof createRealtimeClient> | null = null;
    let renewSubscription: ((next: SealedLiveQuery<LiveMovementRow>) => Promise<void>) | null = null;
    let stopSubscription: (() => void) | null = null;
    let renewalTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchSealedQuery = async (): Promise<SealedLiveQuery<LiveMovementRow>> => {
      const response = await fetch("/api/mobflow/stock-movements/live-query", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!response.ok) throw new Error("Falha ao iniciar histórico em tempo real (HTTP " + response.status + ").");
      return await response.json() as SealedLiveQuery<LiveMovementRow>;
    };

    const start = async () => {
      try {
        const sealed = await fetchSealedQuery();
        if (stopped) return;
        const url = import.meta.env["VITE_NEON_REALTIME_URL"];
        if (!url) throw new Error("Neon Realtime não está configurado neste Preview.");
        client = createRealtimeClient({ url, logLevel: import.meta.env.DEV ? "warn" : "error" });
        const activeSubscription = client.subscribe(sealed);
        renewSubscription = (next) => activeSubscription.renew(next);
        stopSubscription = () => activeSubscription.unsubscribe();
        activeSubscription.onChange((snapshot) => {
          if (stopped || !snapshot.data) return;
          setLiveMovements(snapshot.data.map(mapLiveMovement).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
          setRealtimeStatus("live");
          setRealtimeError("");
        });
        activeSubscription.onStateChange((state) => {
          if (state.status === "error") {
            setRealtimeStatus("error");
            setRealtimeError(state.error.message);
          } else if (state.status === "live") {
            setRealtimeStatus("live");
          }
        });

        const renew = async () => {
          if (stopped || !renewSubscription) return;
          try {
            const next = await fetchSealedQuery();
            if (stopped || !renewSubscription) return;
            await renewSubscription(next);
            renewalTimer = setTimeout(() => { void renew(); }, Math.max(1000, next.expiresAt - Date.now() - 10_000));
          } catch (error) {
            if (!stopped) {
              setRealtimeStatus("error");
              setRealtimeError(error instanceof Error ? error.message : "Não foi possível renovar o histórico em tempo real.");
            }
          }
        };
        renewalTimer = setTimeout(() => { void renew(); }, Math.max(1000, sealed.expiresAt - Date.now() - 10_000));
      } catch (error) {
        if (!stopped) {
          setRealtimeStatus("error");
          setRealtimeError(error instanceof Error ? error.message : "Não foi possível conectar ao histórico em tempo real.");
        }
      }
    };

    void start();
    return () => {
      stopped = true;
      if (renewalTimer) clearTimeout(renewalTimer);
      stopSubscription?.();
      client?.close();
    };
  }, []);

  const movements = liveMovements ?? cachedMovements;
  const [operation, setOperation] = useState("Todas");
  const [direction, setDirection] = useState("Todas");
  const [fromDate, setFromDate] = useState(() => localDateKey(new Date()));
  const [toDate, setToDate] = useState(() => localDateKey(new Date()));
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<StockMovement | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const operationTypes = useMemo(() => [...new Set(["Venda", "Transferência", "Baixa", "Balanço", "Recebimento", "Saída", "Ajuste de estoque", "Ajuste manual", "Cadastro", "Importação", ...movements.map((m) => m.type)])].sort((a, b) => a.localeCompare(b, "pt-BR")), [movements]);
  const filtered = useMemo(() => movements
    .filter((m) => operation === "Todas" || m.type === operation)
    .filter((m) => direction === "Todas" || (direction === "Entradas" ? m.delta > 0 : direction === "Saídas" ? m.delta < 0 : m.delta === 0))
    .filter((m) => !fromDate || localDateKey(m.date) >= fromDate)
    .filter((m) => !toDate || localDateKey(m.date) <= toDate)
    .filter((m) => !search.trim() || `${m.productName} ${m.productCode ?? ""} ${m.operator ?? ""} ${m.details ?? ""}`.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [movements, operation, direction, fromDate, toDate, search]);

  const clearFilters = () => { const today = localDateKey(new Date()); setOperation("Todas"); setDirection("Todas"); setFromDate(today); setToDate(today); setSearch(""); };
  const formatMoney = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
  const formatQuantity = (value: number, unit: "un" | "kg") => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value)} ${unit}`;
  const formatDate = (value: string, seconds = false) => `${new Date(value).toLocaleDateString("pt-BR")} ${new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) })}`;

  return (
    <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6 xl:px-8 xl:py-8">
      <AppHeader />
      <main className="mx-auto max-w-screen-2xl space-y-5 pt-16">
        <button type="button" onClick={() => navigate({ to: "/operacoes" })} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 font-semibold text-heading hover:bg-muted">
          <ArrowLeft className="h-4 w-4" /> Voltar para Operações
        </button>

        <section className="rounded-2xl bg-white p-5 ring-1 ring-border md:p-7">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-green-600/10 text-green-700"><History className="h-6 w-6" /></div>
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold text-heading md:text-3xl">Movimentações de estoque</h1>
              <p className="mt-1 text-sm md:text-base text-muted-foreground">Consulte entradas, saídas e ajustes registrados no estoque.</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-border md:p-6">
          <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} className="mb-4 flex w-full items-center justify-between gap-2 font-bold text-heading"><span className="inline-flex items-center gap-2"><Filter className="h-5 w-5" /> Filtrar movimentações</span><ChevronDown className={`h-5 w-5 transition-transform ${filtersOpen ? "rotate-180" : ""}`} /></button>
          {filtersOpen && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1.5 text-sm md:text-base font-medium text-heading">Operação
              <select value={operation} onChange={(e) => setOperation(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm md:text-base">
                <option value="Todas">Todas as operações</option>
                {operationTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-sm md:text-base font-medium text-heading">Movimento
              <select value={direction} onChange={(e) => setDirection(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm md:text-base">
                <option value="Todas">Entradas e saídas</option><option value="Entradas">Somente entradas</option><option value="Saídas">Somente saídas</option><option value="Sem alteração">Sem alteração de saldo</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm md:text-base font-medium text-heading">Produto, código ou operador
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Digite para pesquisar" className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm md:text-base" />
            </label>
            <label className="space-y-1.5 text-sm md:text-base font-medium text-heading">Data inicial
              <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm md:text-base" />
            </label>
            <label className="space-y-1.5 text-sm md:text-base font-medium text-heading">Data final
              <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm md:text-base" />
            </label>
            <div className="flex items-end"><button type="button" onClick={clearFilters} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 font-semibold hover:bg-muted"><X className="h-4 w-4" /> Limpar filtros</button></div>
          </div>}
        </section>

        <section className="rounded-2xl bg-white p-4 ring-1 ring-border md:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-heading">Histórico</h2>
              <span className={realtimeStatus === "live" ? "rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800" : realtimeStatus === "error" ? "rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800" : "rounded-full bg-secondary px-2 py-1 text-xs font-semibold text-muted-foreground"}>
                {realtimeStatus === "live" ? "Ao vivo" : realtimeStatus === "error" ? "Sem conexão ao vivo" : "Conectando…"}
              </span>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-sm md:text-base font-semibold text-muted-foreground">{filtered.length} registro(s) no período filtrado</span>
          </div>
          {realtimeError && <p role="status" className="mb-3 text-sm text-amber-700">Atualização ao vivo indisponível: {realtimeError}. Exibindo os dados locais disponíveis.</p>}{filtered.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm md:text-base text-muted-foreground">{movements.length === 0 ? "Ainda não há movimentações registradas para esta empresa." : "Nenhum registro corresponde aos filtros selecionados."}</div> : <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="whitespace-nowrap">Data e hora</TableHead><TableHead>Operação</TableHead><TableHead>Produto</TableHead><TableHead className="whitespace-nowrap text-right">Quantidade</TableHead><TableHead className="whitespace-nowrap text-right">Valor total</TableHead><TableHead className="whitespace-nowrap text-right">Estoque antes</TableHead><TableHead className="whitespace-nowrap text-right">Estoque depois</TableHead><TableHead className="whitespace-nowrap text-right">Variação</TableHead>
              </TableRow></TableHeader>
              <TableBody>{filtered.map((m) => <TableRow key={m.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelected(m)}>
                <TableCell className="whitespace-nowrap">{formatDate(m.date)}</TableCell>
                <TableCell className="whitespace-nowrap">{m.type}</TableCell>
                <TableCell className="min-w-40"><div className="font-medium">{m.productName}</div>{m.productCode && <div className="text-xs md:text-sm text-muted-foreground">Cód. {m.productCode}</div>}</TableCell>
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
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs md:text-sm text-muted-foreground">Data e hora</p><p className="mt-1 font-semibold">{formatDate(selected.date, true)}</p></div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs md:text-sm text-muted-foreground">Tipo de operação</p><p className="mt-1 font-semibold">{selected.type}</p></div>
                <div className="rounded-lg bg-muted/40 p-3 sm:col-span-2"><p className="text-xs md:text-sm text-muted-foreground">Produto</p><p className="mt-1 font-semibold">{selected.productName}</p>{selected.productCode && <p className="text-sm md:text-base text-muted-foreground">Código: {selected.productCode}</p>}</div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs md:text-sm text-muted-foreground">Quantidade movimentada</p><p className="mt-1 font-semibold">{formatQuantity(selected.quantity, selected.unit)}</p></div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs md:text-sm text-muted-foreground">Valor total</p><p className="mt-1 font-semibold">{formatMoney(selected.totalValue)}</p></div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs md:text-sm text-muted-foreground">Estoque antes</p><p className="mt-1 font-semibold">{formatQuantity(selected.stockBefore, selected.unit)}</p></div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs md:text-sm text-muted-foreground">Estoque depois</p><p className="mt-1 font-semibold">{formatQuantity(selected.stockAfter, selected.unit)}</p></div>
                <div className="rounded-lg border p-3 sm:col-span-2"><p className="text-xs md:text-sm text-muted-foreground">Variação final</p><p className={`mt-1 text-lg font-extrabold ${selected.delta > 0 ? "text-green-700" : selected.delta < 0 ? "text-red-600" : "text-muted-foreground"}`}>{selected.delta > 0 ? "+" : ""}{formatQuantity(selected.delta, selected.unit)}</p></div>
                {selected.operator && <div className="rounded-lg bg-muted/40 p-3 sm:col-span-2"><p className="text-xs md:text-sm text-muted-foreground">Operador</p><p className="mt-1 font-semibold">{selected.operator}</p></div>}
                {selected.details && <div className="rounded-lg bg-muted/40 p-3 sm:col-span-2"><p className="text-xs md:text-sm text-muted-foreground">Referência</p><p className="mt-1 text-sm md:text-base">{selected.details}</p></div>}
                <div className="text-xs md:text-sm text-muted-foreground sm:col-span-2">Identificador: {selected.operationId}</div>
              </div>
            </>}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
