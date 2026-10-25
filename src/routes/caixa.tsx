import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, brl, useStore } from "@/lib/store";
import { Banknote, ArrowDownToLine, ArrowUpFromLine, Clock3, CircleAlert, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/caixa")({
  head: () => ({ meta: [{ title: "MobFlow — Abertura e fechamento de caixa" }] }),
  component: CashPage,
});

type Mode = "abrir" | "fechar" | "movimentacao" | "historico";
const money = (value: string) => Number(value.replace(/\./g, "").replace(",", "."));
const fmtDate = (value: string) => new Date(value).toLocaleString("pt-BR");

function CashPage() {
  const navigate = useNavigate();
  const sessions = useStore((s) => s.cashSessions ?? []);
  const movements = useStore((s) => s.cashMovements ?? []);
  const sales = useStore((s) => s.sales);
  const [mode, setMode] = useState<Mode>("abrir");
  const [opening, setOpening] = useState("150,00");
  const [counted, setCounted] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [movementType, setMovementType] = useState<"sangria" | "reforco">("sangria");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ expectedCash: number; countedCash: number; difference: number } | null>(null);
  const [username, setUsername] = useState("");
  const active = sessions.find((s) => s.status === "open" && s.openedBy === username);
  const myClosed = sessions.filter((s) => s.status === "closed" && (s.openedBy === username || s.closedBy === username)).slice(0, 8);
  const activeSales = useMemo(() => sales.filter((s) => s.cashSessionId === active?.id), [sales, active?.id]);
  const activeMovements = movements.filter((m) => m.sessionId === active?.id);
  const cashSales = activeSales.filter((s) => s.payment === "Dinheiro" && s.paid !== false).reduce((sum, s) => sum + s.total, 0);
  const withdrawals = activeMovements.filter((m) => m.type === "sangria").reduce((sum, m) => sum + m.amount, 0);
  const additions = activeMovements.filter((m) => m.type === "reforco").reduce((sum, m) => sum + m.amount, 0);
  const expected = active ? Math.round((active.openingAmount + cashSales - withdrawals + additions) * 100) / 100 : 0;

  useEffect(() => {
    const initialAction = sessionStorage.getItem("mobflow-cash-action");
    setMode(initialAction === "fechar" || initialAction === "movimentacao" || initialAction === "historico" ? initialAction : "abrir");
    setUsername(sessionStorage.getItem("mobflow-username")?.trim() || "");
    const permissions = (() => { try { return JSON.parse(sessionStorage.getItem("mobflow-permissions") || "[]") as string[]; } catch { return []; } })();
    if (sessionStorage.getItem("mobflow-pdv-authorized") !== "1" || !permissions.includes("PDV")) {
      window.alert("Apenas usuários com permissão de PDV podem acessar Abertura/Fechamento de Caixa.");
      navigate({ to: "/" });
    }
    const syncMode = (event: Event) => { const next = (event as CustomEvent).detail; if (next === "abrir" || next === "fechar" || next === "movimentacao" || next === "historico") { setMode(next); setResult(null); setMessage(""); } };
    window.addEventListener("mobflow-cash-action", syncMode);
    return () => window.removeEventListener("mobflow-cash-action", syncMode);
  }, [navigate]);

  const openCash = () => {
    setMessage(""); setResult(null);
    const value = money(opening);
    if (!Number.isFinite(value) || value < 0) { setMessage("Informe um valor inicial válido."); return; }
    const id = actions.openCashSession(value, note);
    if (!id) { setMessage("Não foi possível abrir. Confira se já existe um caixa aberto para este usuário."); return; }
    setMessage("Caixa aberto com sucesso."); setNote("");
  };
  const saveMovement = () => {
    setMessage("");
    const value = money(amount);
    if (!Number.isFinite(value) || value <= 0 || !reason.trim()) { setMessage("Informe um valor maior que zero e o motivo da movimentação."); return; }
    const id = actions.addCashMovement(movementType, value, reason);
    if (!id) { setMessage("Não foi possível registrar. Confirme se há um caixa aberto."); return; }
    setMessage(movementType === "sangria" ? "Sangria registrada." : "Reforço registrado."); setAmount(""); setReason("");
  };
  const closeCash = () => {
    setMessage(""); setResult(null);
    const value = money(counted);
    if (!Number.isFinite(value) || value < 0) { setMessage("Informe o dinheiro contado no caixa."); return; }
    const closed = actions.closeCashSession(value, note);
    if (!closed) { setMessage("Não foi possível fechar o caixa. Confira se existe uma sessão aberta."); return; }
    setResult(closed); setMessage("Fechamento registrado. A diferença ficou salva no histórico."); setCounted(""); setNote("");
  };

  return <div className="min-h-screen bg-background text-foreground"><AppHeader /><main className="mx-auto w-full max-w-4xl px-4 pb-12 pt-20 md:pt-8">
    <div className="mb-6 flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Banknote className="h-6 w-6" /></div><div><div><h1 className="text-2xl font-bold">{mode === "abrir" ? "Abertura de Caixa" : mode === "fechar" ? "Fechamento de Caixa" : mode === "movimentacao" ? "Sangria/Reforço" : "Histórico de Caixa"}</h1><p className="text-sm text-muted-foreground">{mode === "abrir" ? "Informe o valor inicial para começar o turno." : mode === "fechar" ? "Confira o dinheiro físico e registre o fechamento." : mode === "movimentacao" ? "Registre entradas e retiradas de dinheiro." : "Consulte os fechamentos e movimentações anteriores."}</p></div></div></div>
    {message && <div className="mb-4 rounded-xl border border-border bg-card p-3 text-sm" role="status">{message}</div>}
    {active && mode === "abrir" && <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><h2 className="text-lg font-bold">Já existe um caixa aberto</h2><p className="mt-2 text-sm text-muted-foreground">Este caixa foi aberto em {fmtDate(active.openedAt)}. Para continuar, use Fechamento, Sangria/Reforço ou Histórico no menu lateral.</p></section>}
    {!active && mode === "abrir" && <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><h2 className="mb-1 text-lg font-bold">Abrir caixa</h2><p className="mb-4 text-sm text-muted-foreground">Conte o dinheiro que ficará na gaveta para dar troco. Esse valor não é uma venda.</p><label className="mb-1 block text-sm font-medium">Dinheiro inicial (R$)</label><input value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" placeholder="150,00" className="mb-4 w-full rounded-xl border border-border bg-background px-3 py-3 text-lg" /><label className="mb-1 block text-sm font-medium">Observação (opcional)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: troco conferido" className="mb-5 w-full rounded-xl border border-border bg-background px-3 py-3" /><button onClick={openCash} className="w-full rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground">Confirmar abertura</button></section>}
    {active && mode === "movimentacao" && <section className="mb-5 rounded-2xl border border-border bg-card p-5 shadow-sm"><h2 className="mb-3 text-lg font-bold">Sangria ou reforço</h2><p className="mb-4 text-sm text-muted-foreground">Sangria é retirar dinheiro da gaveta; reforço é colocar dinheiro adicional no caixa. Os dois ficam registrados no histórico.</p><div className="mb-3 grid grid-cols-2 gap-2"><button onClick={() => setMovementType("sangria")} className={`rounded-xl border p-3 font-semibold ${movementType === "sangria" ? "border-red-500 bg-red-500/10 text-red-700" : "border-border"}`}><ArrowUpFromLine className="mr-2 inline h-4 w-4" />Sangria</button><button onClick={() => setMovementType("reforco")} className={`rounded-xl border p-3 font-semibold ${movementType === "reforco" ? "border-green-500 bg-green-500/10 text-green-700" : "border-border"}`}><ArrowDownToLine className="mr-2 inline h-4 w-4" />Reforço</button></div><label className="mb-1 block text-sm font-medium">Valor (R$)</label><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" className="mb-3 w-full rounded-xl border border-border bg-background px-3 py-3" /><label className="mb-1 block text-sm font-medium">Motivo obrigatório</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: retirada para o cofre" className="mb-4 w-full rounded-xl border border-border bg-background px-3 py-3" /><button onClick={saveMovement} className="w-full rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground">Registrar movimentação</button></section>}
    {active && mode === "fechar" && <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="mb-4 rounded-xl border border-border bg-muted/40 p-3"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Caixa aberto</h2><span className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-700">Em andamento</span></div><p className="mb-3 text-xs text-muted-foreground">Aberto: {fmtDate(active.openedAt)}</p><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[{label:"Troco inicial",value:active.openingAmount},{label:"Vendas em dinheiro",value:cashSales},{label:"Sangrias",value:-withdrawals},{label:"Reforços",value:additions}].map((item) => <div key={item.label} className="rounded-lg bg-background p-2"><p className="text-xs text-muted-foreground">{item.label}</p><p className="mt-1 font-bold">R$ {brl(item.value)}</p></div>)}</div><p className="mt-3 text-sm text-muted-foreground">Dinheiro esperado na gaveta</p><p className="text-2xl font-bold">R$ {brl(expected)}</p><p className="mt-1 text-xs text-muted-foreground">Pix e cartão não entram no dinheiro físico esperado.</p></div><h2 className="mb-1 text-lg font-bold">Fechar caixa</h2><p className="mb-4 text-sm text-muted-foreground">Conte somente o dinheiro físico que está na gaveta, incluindo o troco inicial e considerando sangrias e reforços.</p><div className="mb-4 rounded-xl bg-muted/50 p-3"><div className="flex justify-between text-sm"><span>Dinheiro esperado</span><strong>R$ {brl(expected)}</strong></div><div className="mt-2 flex justify-between text-sm"><span>Vendas em dinheiro</span><strong>R$ {brl(cashSales)}</strong></div><div className="mt-2 flex justify-between text-sm"><span>Movimentações líquidas</span><strong>R$ {brl(additions - withdrawals)}</strong></div></div><label className="mb-1 block text-sm font-medium">Dinheiro contado (R$)</label><input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" placeholder="0,00" className="mb-4 w-full rounded-xl border border-border bg-background px-3 py-3 text-lg" /><label className="mb-1 block text-sm font-medium">Observação (opcional)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: diferença conferida com gerente" className="mb-5 w-full rounded-xl border border-border bg-background px-3 py-3" /><button onClick={closeCash} className="w-full rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground">Confirmar fechamento</button></section>}
    {result && <div className={`mt-4 rounded-2xl border p-4 ${result.difference === 0 ? "border-green-500/40 bg-green-500/10" : "border-amber-500/40 bg-amber-500/10"}`}><div className="flex items-center gap-2 font-bold">{result.difference === 0 ? <CheckCircle2 className="h-5 w-5" /> : <CircleAlert className="h-5 w-5" />}{result.difference === 0 ? "Caixa conferido sem diferença" : "Fechamento com diferença"}</div><div className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><p className="text-muted-foreground">Esperado</p><strong>R$ {brl(result.expectedCash)}</strong></div><div><p className="text-muted-foreground">Contado</p><strong>R$ {brl(result.countedCash)}</strong></div><div><p className="text-muted-foreground">Diferença</p><strong>R$ {brl(result.difference)}</strong></div></div><p className="mt-2 text-xs text-muted-foreground">O fechamento foi salvo no histórico.</p></div>}
    {mode === "historico" && active && activeMovements.length > 0 && <section className="mt-5 rounded-2xl border border-border bg-card p-5"><h2 className="mb-3 font-bold">Movimentações desta sessão</h2><div className="space-y-2">{activeMovements.map((m) => <div key={m.id} className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm"><div><p className="font-medium">{m.type === "sangria" ? "Sangria" : "Reforço"} · {m.reason}</p><p className="text-xs text-muted-foreground">{fmtDate(m.date)} · {m.operator}</p></div><strong>R$ {brl(m.amount)}</strong></div>)}</div></section>}
    {mode === "historico" && myClosed.length > 0 && <section className="mt-5 rounded-2xl border border-border bg-card p-5"><h2 className="mb-3 flex items-center gap-2 font-bold"><Clock3 className="h-4 w-4" />Histórico dos últimos fechamentos</h2><div className="space-y-3">{myClosed.map((s) => <div key={s.id} className="border-b border-border pb-3 last:border-0"><div className="flex flex-wrap justify-between gap-2"><strong>{fmtDate(s.closedAt || s.openedAt)}</strong><strong className={s.difference === 0 ? "text-green-700" : "text-amber-700"}>Diferença: R$ {brl(s.difference ?? 0)}</strong></div><p className="text-sm text-muted-foreground">Operador: {s.openedBy} · Esperado: R$ {brl(s.expectedCash ?? 0)} · Contado: R$ {brl(s.countedCash ?? 0)}</p></div>)}</div></section>}
    {!active && mode === "movimentacao" && <section className="rounded-2xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Abra o caixa antes de registrar sangrias ou reforços.</p><button onClick={() => setMode("abrir")} className="mt-3 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">Ir para abertura</button></section>}
    {mode === "historico" && !active && myClosed.length === 0 && <section className="rounded-2xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Ainda não há fechamentos registrados para este usuário.</p></section>}
    {!active && mode === "fechar" && !result && <section className="rounded-2xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Não há caixa aberto para este usuário. Selecione “Abrir caixa” para iniciar uma nova sessão.</p><button onClick={() => setMode("abrir")} className="mt-3 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">Ir para abrir caixa</button></section>}
  </main></div>;
}