import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { actions, brl, printFiadoBalance, printReceipt, useStore, type Sale } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { UserRound, Printer, Trash2, ArrowLeft, ReceiptText, LockKeyhole } from "lucide-react";

export const Route = createFileRoute("/fiado")({
  head: () => ({ meta: [{ title: "MobFlow — Fiado" }] }),
  component: Fiado,
});

function Fiado() {
  const sales = useStore((s) => s.sales);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"todos" | "pendentes" | "pagos">("todos");
  const navigate = useNavigate();
  const [paymentValue, setPaymentValue] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [pendingChange, setPendingChange] = useState<(() => void) | null>(null);
  const formatMoneyInput = (value: string) => { const digits = value.replace(/\D/g, ""); if (!digits) return ""; return (Number(digits) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const confirmFiadoChange = (change: () => void) => {
    if (authorizing) return;
    setPendingChange(() => change);
    setPasswordInput("");
    setPasswordError("");
    setPasswordModalOpen(true);
  };

  const submitFiadoPassword = async () => {
    if (authorizing) return;
    const username = sessionStorage.getItem("mobflow-username")?.trim() || "";
    if (!username) { setPasswordError("Entre com um usuário do PDV para confirmar esta alteração."); return; }
    if (!passwordInput) { setPasswordError("Informe sua senha para confirmar."); return; }
    const cnpj = (localStorage.getItem("mobflow-company-cnpj") || "").replace(/\D/g, "");
    if (cnpj.length !== 14) { setPasswordError("Não foi possível identificar o CNPJ desta empresa. Entre novamente na gerência e tente de novo."); return; }
    setAuthorizing(true);
    setPasswordError("");
    try {
      const { data, error } = await supabase.functions.invoke("mobflow-login", {
        body: { username, password: passwordInput, cnpj, expectedRole: "pdv" },
      });
      if (error || !data?.session || data?.profile?.role !== "pdv") {
        setPasswordError("Senha incorreta ou usuário do PDV inválido.");
        return;
      }
      pendingChange?.();
      setPasswordModalOpen(false);
      setPasswordInput("");
      setPendingChange(null);
    } catch {
      setPasswordError("Não foi possível validar a senha. Tente novamente.");
    } finally {
      setAuthorizing(false);
    }
  };

  const fiado = useMemo(() => sales.filter((s) => s.payment === "Fiado" && !s.hiddenFromFiado), [sales]);
  const customers = useMemo(() => {
    const map = new Map<string, Sale[]>();
    fiado.forEach((s) => {
      const name = (s.customer || "Cliente não informado").trim();
      map.set(name, [...(map.get(name) || []), s]);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [fiado]);
  const paidTotal = (s: Sale) => (s.payments ?? (s.paid ? [{ value: s.total, date: s.paidAt ?? s.date }] : [])).reduce((sum, p) => sum + p.value, 0);
  const remaining = (s: Sale) => { const balance = Math.round((s.total - paidTotal(s)) * 100) / 100; return balance <= 0.005 ? 0 : Math.max(0, balance); };
  const visibleCustomers = useMemo(() => customers.filter(([customer, customerSales]) => { const matchesSearch = customer.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()); const balance = customerSales.reduce((sum, s) => sum + remaining(s), 0); const matchesFilter = filter === "todos" || (filter === "pendentes" ? balance > 0 : balance <= 0); return matchesSearch && matchesFilter; }), [customers, search, filter]);
  const open = fiado.filter((s) => remaining(s) > 0);
  const totalOpen = open.reduce((sum, s) => sum + remaining(s), 0);
  const selectedSales = selectedCustomer ? (customers.find(([name]) => name === selectedCustomer)?.[1] ?? []) : [];
  const selectedBalance = selectedSales.reduce((sum, s) => sum + remaining(s), 0);
  const selectedPaid = selectedBalance <= 0;
  const selectedTotal = selectedSales.reduce((sum, s) => sum + s.total, 0);

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="space-y-4">
        {!selectedCustomer ? (
          <>
            <section className="glass p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="label-mono">CONTAS EM ABERTO</div>
                  <h1 className="mt-1 font-display text-3xl tracking-[.1em] text-heading">FIADO</h1>
                  <p className="mt-1 text-sm text-muted-foreground">{customers.length} cliente(s) · {open.length} compra(s) pendente(s)</p>
                </div>
                <div className="text-right"><div className="label-mono">SALDO TOTAL</div><div className="font-display text-3xl text-destructive">R$ {brl(totalOpen)}</div></div>
              </div>
            </section>
            <section className="space-y-3">
              <section className="glass p-4"><div className="grid gap-3 md:grid-cols-[1fr_auto]"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar cliente..." className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" /><div className="flex gap-2">{(["todos", "pendentes", "pagos"] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-xl px-4 py-2 text-xs font-bold ${filter === item ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent"}`}>{item === "todos" ? "Todos" : item === "pendentes" ? "Pendentes" : "Pagos"}</button>)}</div></div></section>
              {customers.length === 0 && <div className="glass p-8 text-center text-sm text-muted-foreground">Nenhum fiado registrado.</div>}
              {visibleCustomers.map(([customer, customerSales]) => {
                const total = customerSales.reduce((sum, s) => sum + remaining(s), 0);
                const customerPending = total > 0;
                return (
                  <div key={customer} className="glass p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${customerPending ? "bg-orange-500/15 text-orange-600 ring-1 ring-orange-500/30" : "bg-green-500/15 text-green-600 ring-1 ring-green-500/30"}`}>{customerPending ? "Pendente" : "Pago"}</span><div className="text-lg font-bold text-heading">{customer}</div></div><div className="text-xs text-muted-foreground">{customerSales.length} compra(s) · {customerSales.filter((s) => remaining(s) > 0).length} pendente(s)</div></div>
                      <div className="text-right"><div className={`font-display text-2xl ${customerPending ? "text-destructive" : "text-green-600"}`}>R$ {brl(total)}</div><div className="text-[11px] text-muted-foreground">saldo restante</div></div>
                      <button onClick={() => setSelectedCustomer(customer)} className="rounded-lg bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20"><UserRound className="mr-1 inline h-4 w-4 text-green-600" />Ver cliente</button>
                      <button onClick={() => printFiadoBalance(customer, customerSales)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent"><Printer className="mr-1 inline h-4 w-4 text-green-600" />Imprimir saldo</button>
                      <button onClick={() => { if (window.confirm(`Remover ${customer} da aba Fiado? As vendas e os lucros continuarão registrados em Vendas.`)) void confirmFiadoChange(() => { actions.hideFiadoCustomer(customer); if (selectedCustomer === customer) setSelectedCustomer(null); }); }} disabled={authorizing} className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"><Trash2 className="mr-1 inline h-4 w-4" />Excluir do Fiado</button>
                    </div>
                  </div>
                );
              })}
            </section>
          </>
        ) : (
          <>
            <button onClick={() => { setSelectedCustomer(null); setPaymentValue(""); }} className="rounded-xl bg-secondary px-4 py-2 text-sm font-semibold hover:bg-accent"><ArrowLeft className="mr-1 inline h-4 w-4 text-green-600" />Voltar para Fiado</button>
            <section className="glass p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><div className="label-mono">DETALHES DO CLIENTE</div><div className="mt-1 flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${selectedPaid ? "bg-green-500/15 text-green-600 ring-1 ring-green-500/30" : "bg-orange-500/15 text-orange-600 ring-1 ring-orange-500/30"}`}>{selectedPaid ? "Pago" : "Pendente"}</span><h1 className="font-display text-3xl tracking-[.06em] text-heading">{selectedCustomer}</h1></div><p className="mt-2 text-sm text-muted-foreground">{selectedSales.length} compra(s) no histórico · Total comprado: R$ {brl(selectedTotal)}</p></div>
                <div className="text-right"><div className="label-mono">SALDO RESTANTE</div><div className={`font-display text-4xl ${selectedPaid ? "text-green-600" : "text-destructive"}`}>R$ {brl(selectedBalance)}</div><div className="mt-2 flex flex-wrap justify-end gap-2">
                    <button onClick={() => printFiadoBalance(selectedCustomer, selectedSales)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent"><Printer className="mr-1 inline h-4 w-4 text-green-600" />Imprimir saldo</button>
                    {selectedBalance > 0 && <button disabled={authorizing} onClick={() => { if (!window.confirm(`Quitar todas as compras pendentes de ${selectedCustomer}, no total de R$ ${brl(selectedBalance)}?`)) return; void confirmFiadoChange(() => { selectedSales.forEach(s => { const due = remaining(s); if (due > 0) actions.addFiadoPayment(s.id, due); }); setPaymentValue(""); }); }} className="rounded-lg bg-green-600 px-4 py-2 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50">{authorizing ? "Confirmando..." : "✓ Quitar tudo"}</button>}
                  </div></div>
              </div>
            </section>
            <section className="glass p-5">
              <div className="mb-4"><div className="label-mono">HISTÓRICO DE COMPRAS</div><h2 className="mt-1 text-xl font-bold text-heading">Compras e pagamentos</h2></div>
              <div className="space-y-4">
                {[...selectedSales].sort((a,b) => +new Date(b.date)-+new Date(a.date)).map((s) => {
                  const paidAmount=paidTotal(s), due=remaining(s), draft=paymentValue;
                  return <article key={s.id} className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                    <div className="grid gap-4 md:grid-cols-[1fr_auto]"><div><div className="text-sm font-semibold text-heading">{new Date(s.date).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</div><div className="mt-2 text-base leading-relaxed font-medium text-foreground">{s.items.map(i => `${i.qty}× ${i.name}`).join(", ")}</div></div><div className="text-left md:text-right"><div className="font-display text-2xl text-heading">R$ {brl(s.total)}</div><div className="mt-1 text-sm text-muted-foreground">Pago: <strong>R$ {brl(paidAmount)}</strong></div><div className={`text-sm font-bold ${due>0 ? "text-orange-600" : "text-green-600"}`}>Saldo: R$ {brl(due)}</div></div></div>
                    {due>0 && <div className="mt-4 rounded-2xl border border-border/60 bg-background/60 p-4"><div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center"><div><div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Falta pagar</div><div className="mt-1 font-display text-4xl text-heading">R$ {brl(due)}</div></div><div className="flex flex-wrap items-center gap-2"><input inputMode="decimal" value={draft} onChange={e=>setPaymentValue(formatMoneyInput(e.target.value))} placeholder="0,00" className="w-40 rounded-xl border-2 border-border bg-background px-4 py-3 text-lg font-bold text-center outline-none focus:border-primary"/><button onClick={()=>{const value=Number(draft.replace(/\./g,"").replace(",","."));if(Number.isFinite(value)&&value>0){void confirmFiadoChange(()=>{actions.addFiadoPayment(s.id,value);setPaymentValue("");});}}} className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground">Adicionar pagamento</button><button onClick={()=>{void confirmFiadoChange(()=>{actions.addFiadoPayment(s.id,due);setPaymentValue("");});}} className="rounded-xl bg-green-500/15 px-4 py-3 text-sm font-bold text-green-600">Quitar tudo</button></div></div></div>}
                    <div className="mt-4"><div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Pagamentos já feitos</div>{(s.payments??[]).length>0?<div className="max-w-xl space-y-2">{(s.payments??[]).map((p,i)=><div key={i} className="grid grid-cols-[1fr_auto] items-center rounded-xl bg-background/70 px-4 py-3"><span className="text-sm text-muted-foreground">{new Date(p.date).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</span><span className="font-display text-xl font-bold text-green-600">R$ {brl(p.value)}</span></div>)}</div>:<div className="text-sm text-muted-foreground">Nenhum pagamento registrado ainda.</div>}</div>
                    <div className="mt-4 flex justify-end"><button onClick={()=>printReceipt(s)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent"><ReceiptText className="mr-1 inline h-4 w-4 text-green-600" />Imprimir compra</button></div>
                  </article>;
                })}
              </div>
            </section>
          </>
        )}

      {passwordModalOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-background/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <form onSubmit={(e) => { e.preventDefault(); void submitFiadoPassword(); }} className="w-full max-w-md glass p-6 shadow-2xl">
            <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-primary/10"><LockKeyhole className="h-5 w-5 text-primary" /></div>
            <h2 className="text-xl font-bold text-heading">Confirmar senha do usuário</h2>
            <p className="mt-2 text-sm text-muted-foreground">Para confirmar esta alteração no fiado, digite novamente a senha do usuário do PDV.</p>
            <input type="password" value={passwordInput} onChange={e => { setPasswordInput(e.target.value); setPasswordError(""); }} placeholder="Senha do usuário" autoComplete="current-password" autoFocus className="field mt-4 w-full text-foreground" />
            {passwordError && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{passwordError}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => { setPasswordModalOpen(false); setPasswordInput(""); setPasswordError(""); setPendingChange(null); }} className="flex-1 rounded-xl bg-secondary px-4 py-3 text-sm font-semibold text-secondary-foreground">Cancelar</button>
              <button type="submit" disabled={authorizing} className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{authorizing ? "Validando..." : "Confirmar"}</button>
            </div>
          </form>
        </div>
      )}
      </main>
    </div>
  );
}