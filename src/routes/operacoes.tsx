import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { ClipboardList, ClipboardCheck, PackageMinus, ArrowLeftRight, Scale, LockKeyhole, Users, History, PackageCheck, TrendingUp, TrendingDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useStore, type StockMovement } from "@/lib/store";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/operacoes")({
  head: () => ({ meta: [{ title: "MobFlow — Operações" }] }),
  component: Operacoes,
});

function Operacoes() {
  const navigate = useNavigate();
  const receiving = useStore((s) => s.receiving ?? []);
  const stockMovements = useStore((s) => s.stockMovements ?? []);
  const [showMovements, setShowMovements] = useState(false);
  const [selectedMovement, setSelectedMovement] = useState<StockMovement | null>(null);
  const orderedMovements = useMemo(() => [...stockMovements].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [stockMovements]);
  const formatMoney = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
  const formatQuantity = (value: number, unit: "un" | "kg") => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value)} ${unit}`;
  const hasActionToDo = receiving.some((note) => note.stockReleased && Object.values(note.decisions ?? {}).includes("devolver") && !note.actionCompleted);
  const [hasManagementAccess, setHasManagementAccess] = useState(false);
  useEffect(() => {
    const readPermissions = () => {
      try {
        const permissions = JSON.parse(sessionStorage.getItem("mobflow-permissions") || "[]") as string[];
        setHasManagementAccess(permissions.includes("Gerência"));
      } catch { setHasManagementAccess(false); }
    };
    readPermissions();
    window.addEventListener("mobflow-pdv-auth-changed", readPermissions);
    return () => window.removeEventListener("mobflow-pdv-auth-changed", readPermissions);
  }, []);
  const items = [
    { title: "Conferência", description: "Conferir os produtos recebidos e as notas pendentes.", icon: ClipboardCheck, ready: true },
    { title: "Baixa de produtos", description: "Registrar saídas, perdas ou produtos danificados.", icon: PackageMinus, ready: true },
    { title: "Transferência", description: "Transferir produtos para uma empresa ou cliente e emitir a DANFE.", icon: ArrowLeftRight, ready: true },
    { title: "Balanço de estoque", description: "Conferir quantidades e ajustar o saldo dos produtos.", icon: Scale, ready: true },
    { title: "Fornecedores e Clientes", description: "Cadastre e consulte fornecedores e clientes para reutilizar seus dados nas operações.", icon: Users, ready: true },
    { title: "Movimentações de estoque", description: "Consulte entradas e saídas registradas, com saldo anterior e saldo atualizado.", icon: History, ready: true },
  ];
  return (
    <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
      <AppHeader />
      <main className="mx-auto max-w-5xl space-y-6 pt-16">
        <section className="rounded-2xl bg-white p-5 ring-1 ring-border md:p-7">
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <div className="flex items-center justify-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-green-600/10 text-green-700"><ClipboardList className="h-6 w-6" /></div>
              <h1 className="font-display text-3xl font-extrabold text-heading md:text-4xl">OPERAÇÕES</h1>
            </div>
          </div>
        </section>
        {hasManagementAccess && <div className="flex justify-center"><button type="button" onClick={() => navigate({ to: "/gerencia" })} className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-green-800"><LockKeyhole className="h-4 w-4" /> Voltar para Gerência</button></div>}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.title} type="button" onClick={() => item.title === "Movimentações de estoque" ? setShowMovements((visible) => !visible) : item.title === "Conferência" ? navigate({ to: "/conferencia" }) : item.title === "Baixa de produtos" ? navigate({ to: "/baixa-produtos" }) : item.title === "Transferência" ? navigate({ to: "/transferencias" }) : item.title === "Balanço de estoque" ? navigate({ to: "/balanco-estoque" }) : item.title === "Fornecedores e Clientes" ? navigate({ to: "/fornecedores-clientes" }) : window.alert(item.title + " será configurada na próxima etapa.")} className={`rounded-2xl bg-white p-5 text-left ring-1 transition hover:-translate-y-0.5 hover:ring-primary/50 ${item.title === "Movimentações de estoque" && showMovements ? "ring-2 ring-green-600" : "ring-border"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="relative grid h-12 w-12 place-items-center rounded-xl bg-green-600/10 text-green-700"><Icon className="h-6 w-6" />
                    {item.title === "Conferência" && hasActionToDo && <span className="absolute left-14 top-0 whitespace-nowrap rounded-md bg-amber-300 px-2 py-1 text-[10px] font-extrabold leading-tight text-amber-950 shadow-sm">AÇÃO A SER FEITA</span>}
                  </div>
                  {!item.ready && <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">Em preparação</span>}
                </div>
                <h2 className="mt-4 font-bold text-heading">{item.title}</h2>
                <p className="mt-2 text-sm leading-5 text-muted-foreground">{item.description}</p>
              </button>
            );
          })}
        </section>
        {showMovements && <section className="rounded-2xl bg-white p-4 ring-1 ring-border md:p-6">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-heading">Movimentações de estoque</h2>
              <p className="mt-1 text-sm text-muted-foreground">Registro para consulta. Toque em uma linha para ver os dados completos da movimentação.</p>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-muted-foreground">{orderedMovements.length} registro(s)</span>
          </div>
          {orderedMovements.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Ainda não há movimentações registradas nesta lista. As novas operações de estoque aparecerão aqui automaticamente.</div> : <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="whitespace-nowrap">Data e hora</TableHead><TableHead>Tipo</TableHead><TableHead>Produto</TableHead><TableHead className="text-right">Quantidade</TableHead><TableHead className="whitespace-nowrap text-right">Valor total</TableHead><TableHead className="whitespace-nowrap text-right">Estoque antes</TableHead><TableHead className="whitespace-nowrap text-right">Estoque atual</TableHead><TableHead className="whitespace-nowrap text-right">Final</TableHead>
              </TableRow></TableHeader>
              <TableBody>{orderedMovements.map((movement) => <TableRow key={movement.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedMovement(movement)}>
                <TableCell className="whitespace-nowrap"><button type="button" className="text-left font-medium text-primary underline-offset-4 hover:underline" onClick={(event) => { event.stopPropagation(); setSelectedMovement(movement); }}>{new Date(movement.date).toLocaleDateString("pt-BR")} {new Date(movement.date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</button></TableCell>
                <TableCell className="whitespace-nowrap">{movement.type}</TableCell><TableCell className="min-w-44"><div className="font-medium">{movement.productName}</div>{movement.productCode && <div className="text-xs text-muted-foreground">Cód. {movement.productCode}</div>}</TableCell>
                <TableCell className="whitespace-nowrap text-right">{formatQuantity(movement.quantity, movement.unit)}</TableCell><TableCell className="whitespace-nowrap text-right">{formatMoney(movement.totalValue)}</TableCell><TableCell className="whitespace-nowrap text-right">{formatQuantity(movement.stockBefore, movement.unit)}</TableCell><TableCell className="whitespace-nowrap text-right font-semibold">{formatQuantity(movement.stockAfter, movement.unit)}</TableCell><TableCell className={`whitespace-nowrap text-right font-bold ${movement.delta > 0 ? "text-green-700" : movement.delta < 0 ? "text-red-600" : "text-muted-foreground"}`}>{movement.delta > 0 ? "+" : ""}{new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(movement.delta)} {movement.delta > 0 ? <TrendingUp className="ml-1 inline h-4 w-4" /> : movement.delta < 0 ? <TrendingDown className="ml-1 inline h-4 w-4" /> : null}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </div>}
        </section>}
        <Dialog open={!!selectedMovement} onOpenChange={(open) => { if (!open) setSelectedMovement(null); }}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            {selectedMovement && <>
              <DialogHeader><DialogTitle>Detalhes da movimentação</DialogTitle><DialogDescription>Registro individual do estoque, somente para consulta.</DialogDescription></DialogHeader>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Data e hora</p><p className="mt-1 font-semibold">{new Date(selectedMovement.date).toLocaleDateString("pt-BR")} às {new Date(selectedMovement.date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p></div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Tipo de operação</p><p className="mt-1 font-semibold">{selectedMovement.type}</p></div>
                <div className="rounded-lg bg-muted/40 p-3 sm:col-span-2"><p className="text-xs text-muted-foreground">Produto</p><p className="mt-1 font-semibold">{selectedMovement.productName}</p>{selectedMovement.productCode && <p className="text-sm text-muted-foreground">Código: {selectedMovement.productCode}</p>}</div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Quantidade movimentada</p><p className="mt-1 font-semibold">{formatQuantity(selectedMovement.quantity, selectedMovement.unit)}</p></div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Valor total</p><p className="mt-1 font-semibold">{formatMoney(selectedMovement.totalValue)}</p></div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Estoque antes</p><p className="mt-1 font-semibold">{formatQuantity(selectedMovement.stockBefore, selectedMovement.unit)}</p></div>
                <div className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Estoque atual após operação</p><p className="mt-1 font-semibold">{formatQuantity(selectedMovement.stockAfter, selectedMovement.unit)}</p></div>
                <div className="rounded-lg border p-3 sm:col-span-2"><p className="text-xs text-muted-foreground">Variação final</p><p className={`mt-1 text-lg font-extrabold ${selectedMovement.delta > 0 ? "text-green-700" : selectedMovement.delta < 0 ? "text-red-600" : "text-muted-foreground"}`}>{selectedMovement.delta > 0 ? "+" : ""}{formatQuantity(selectedMovement.delta, selectedMovement.unit)}</p></div>
                {selectedMovement.operator && <div className="rounded-lg bg-muted/40 p-3 sm:col-span-2"><p className="text-xs text-muted-foreground">Operador</p><p className="mt-1 font-semibold">{selectedMovement.operator}</p></div>}
                {selectedMovement.details && <div className="rounded-lg bg-muted/40 p-3 sm:col-span-2"><p className="text-xs text-muted-foreground">Referência</p><p className="mt-1 text-sm">{selectedMovement.details}</p></div>}
                <div className="text-xs text-muted-foreground sm:col-span-2">Identificador: {selectedMovement.operationId}</div>
              </div>
            </>}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
