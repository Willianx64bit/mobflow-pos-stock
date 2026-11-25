import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { actions, brl, buildPixPayload, isOfflineMode, printReceipt, useStore, type Sale } from "@/lib/store";
import { isValidOfflineFiadoSession } from "@/lib/offline-fiado-auth";

import { UserRound, ArrowLeft, ReceiptText, LockKeyhole, SlidersHorizontal, CalendarDays } from "lucide-react";

export const Route = createFileRoute("/fiado")({
  head: () => ({ meta: [{ title: "MobFlow — Fiado" }] }),
  component: Fiado,
});

function Fiado() {
  const sales = useStore((s) => s.sales);
  const settings = useStore((s) => s.settings);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"todos" | "pendentes" | "pagos">("todos");
  const navigate = useNavigate();
  const [paymentValue, setPaymentValue] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "pix">("cash");
  const [pixPayment, setPixPayment] = useState<{ payments: Array<{ saleId: string; amount: number }>; amount: number; payload: string } | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);
  const [purchaseFilter, setPurchaseFilter] = useState<"todos" | "pendentes" | "quitados">("pendentes");
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const [dateFilterMode, setDateFilterMode] = useState<"month" | "custom">("month");
  const [monthDraft, setMonthDraft] = useState(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; });
  const [startDateDraft, setStartDateDraft] = useState("");
  const [endDateDraft, setEndDateDraft] = useState("");
  const [appliedDateFilter, setAppliedDateFilter] = useState<{ mode: "month" | "custom"; month: string; start: string; end: string } | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [offlineAuthorizationBlocked, setOfflineAuthorizationBlocked] = useState(false);
  const [pendingChange, setPendingChange] = useState<(() => void | Promise<void>) | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmDialogMessage, setConfirmDialogMessage] = useState("");
  const [pendingConfirmation, setPendingConfirmation] = useState<(() => void | Promise<void>) | null>(null);
  const [settledReceipt, setSettledReceipt] = useState<{ customer: string; amount: number } | null>(null);
  const formatMoneyInput = (value: string) => { const digits = value.replace(/\D/g, ""); if (!digits) return ""; return (Number(digits) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const requestFiadoConfirmation = (message: string, change: () => void | Promise<void>) => {
    setConfirmDialogMessage(message);
    setPendingConfirmation(() => change);
    setConfirmDialogOpen(true);
  };
  const continueFiadoConfirmation = () => {
    const change = pendingConfirmation;
    setConfirmDialogOpen(false);
    setPendingConfirmation(null);
    if (change) confirmFiadoChange(change);
  };

  const confirmFiadoChange = async (change: () => void | Promise<void>) => {
    if (authorizing) return;
    const desktop = typeof window !== "undefined"
      ? (window as Window & { mobflowDesktop?: { getCachedAuthorizedSession?: () => Promise<{ accountId: string; role: string; username: string; permissions: string[]; savedAt: number } | null> } }).mobflowDesktop
      : undefined;
    if (desktop && typeof navigator !== "undefined" && (!navigator.onLine || isOfflineMode())) {
      setAuthorizing(true);
      setPasswordError("");
      setOfflineAuthorizationBlocked(false);
      try {
        const cached = await desktop.getCachedAuthorizedSession?.();
        const expectedAccount = localStorage.getItem("mobflow:owner");
        const expectedUsername = sessionStorage.getItem("mobflow-username")?.trim();
        const valid = isValidOfflineFiadoSession(cached, expectedAccount, expectedUsername);
        if (!valid) {
          setOfflineAuthorizationBlocked(true);
          setPasswordError("Não há uma sessão PDV válida neste computador. Conecte-se à internet e entre novamente para autorizar recebimentos offline.");
          setPasswordModalOpen(true);
          return;
        }
        await change();
        setPendingChange(null);
        setPasswordInput("");
        return;
      } catch (error) {
        setOfflineAuthorizationBlocked(true);
        setPasswordError(error instanceof Error ? error.message : "Não foi possível validar a sessão offline. Conecte-se à internet.");
        setPasswordModalOpen(true);
        return;
      } finally {
        setAuthorizing(false);
      }
    }
    setOfflineAuthorizationBlocked(false);
    setPendingChange(() => change);
    setPasswordInput("");
    setPasswordError("");
    setPasswordModalOpen(true);
  };

  const completeOfflineFiadoAuthorization = async () => {
    const desktop = typeof window !== "undefined"
      ? (window as Window & { mobflowDesktop?: { getCachedAuthorizedSession?: () => Promise<{ accountId: string; role: string; username: string; permissions: string[]; savedAt: number } | null> } }).mobflowDesktop
      : undefined;
    if (!desktop) return false;
    const cached = await desktop.getCachedAuthorizedSession?.().catch(() => null);
    const expectedAccount = localStorage.getItem("mobflow:owner");
    const expectedUsername = sessionStorage.getItem("mobflow-username")?.trim();
    if (!isValidOfflineFiadoSession(cached, expectedAccount, expectedUsername)) return false;
    await pendingChange?.();
    setPasswordModalOpen(false);
    setPasswordInput("");
    setPendingChange(null);
    setPasswordError("");
    setOfflineAuthorizationBlocked(false);
    return true;
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
      const response = await fetch("/api/mobflow/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password: passwordInput, cnpj, expectedRole: "pdv" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok || data?.profile?.role !== "pdv") {
        // A server-side outage is not the same as an invalid password. If this
        // is the same authorized PDV on this EXE, accept the protected local grant.
        if ((response.status >= 500 || response.headers.get("x-mobflow-local-proxy-error") === "1") &&
            await completeOfflineFiadoAuthorization()) return;
        setPasswordError("Senha incorreta ou usuário do PDV inválido.");
        return;
      }
      await pendingChange?.();
      setPasswordModalOpen(false);
      setPasswordInput("");
      setPendingChange(null);
    } catch (error) {
      // A dropped connection can happen while navigator.onLine still says true.
      // Fall back only to the same tenant/user's unexpired encrypted PDV grant.
      try {
        if (await completeOfflineFiadoAuthorization()) return;
      } catch (offlineError) {
        setPasswordError(offlineError instanceof Error ? offlineError.message : "Não foi possível validar a autorização offline.");
        return;
      }
      setPasswordError(error instanceof Error ? error.message : "Não foi possível concluir a operação. Tente novamente.");
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
  const selectedSales = selectedCustomer ? (customers.find(([name]) => name === selectedCustomer)?.[1] ?? []) : [];
  const selectedBalance = selectedSales.reduce((sum, s) => sum + remaining(s), 0);
  const selectedPaid = selectedBalance <= 0;

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
                </div>
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
                      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><div className="text-lg font-bold text-heading">{customer}</div></div><div className="text-xs text-muted-foreground">{customerSales.length} compra(s) · {customerSales.filter((s) => remaining(s) > 0).length} pendente(s)</div></div>
                      <div className="text-right"><div className={`font-display text-2xl ${customerPending ? "text-orange-600" : "text-green-600"}`}>R$ {brl(total)}</div><div className="text-[11px] text-muted-foreground">saldo restante</div></div>
                      <button onClick={() => setSelectedCustomer(customer)} className="rounded-lg bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20"><UserRound className="mr-1 inline h-4 w-4 text-green-600" />Ver cliente</button>

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
                <div className="min-w-0 flex-1"><div className="label-mono">DETALHES DO CLIENTE</div><div className="mt-1 flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${selectedPaid ? "bg-green-500/15 text-green-600 ring-1 ring-green-500/30" : "bg-orange-500/15 text-orange-600 ring-1 ring-orange-500/30"}`}>{selectedPaid ? "Pago" : "Pendente"}</span><h1 className="font-display text-3xl tracking-[.06em] text-heading">{selectedCustomer}</h1></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3"><div className="rounded-xl border border-border bg-background/70 px-3 py-2"><div className="text-xs text-muted-foreground">Compras</div><div className="font-display text-xl">{selectedSales.length}</div></div><div className="rounded-xl border border-border bg-background/70 px-3 py-2"><div className="text-xs text-muted-foreground">Já pago</div><div className="font-display text-xl text-green-600">R$ {brl(selectedSales.reduce((sum,s)=>sum+paidTotal(s),0))}</div></div><div className="col-span-2 rounded-xl border border-border bg-background/70 px-3 py-2 sm:col-span-1"><div className="text-xs text-muted-foreground">Saldo restante</div><div className={`font-display text-xl ${selectedPaid ? "text-green-600" : "text-orange-600"}`}>R$ {brl(selectedBalance)}</div></div></div></div><div className="flex flex-wrap items-start justify-end gap-2"><button onClick={() => { if (selectedBalance > 0) { const amountPaid = selectedBalance; const customerName = selectedCustomer; const payments = selectedSales.map((sale) => ({ saleId: sale.id, amount: remaining(sale) })).filter((payment) => payment.amount > 0); if(paymentMethod==="pix"){const key=settings.pixKey?.trim();if(!key){setPasswordError("Cadastre a chave Pix em Gerência → Configurações.");return;}setPixPayment({payments,amount:amountPaid,payload:buildPixPayload(key,amountPaid,settings.companyName||"MOBFLOW")});}else{void confirmFiadoChange(async () => { for (const payment of payments) await actions.addFiadoPayment(payment.saleId,payment.amount,paymentMethod); setPaymentValue(""); setSettledReceipt({ customer: customerName, amount: amountPaid }); });} } }} disabled={authorizing || selectedBalance <= 0} className="rounded-lg bg-green-500/15 px-3 py-2 text-xs font-bold text-green-700 hover:bg-green-500/25 disabled:opacity-50"><ReceiptText className="mr-1 inline h-4 w-4" />Quitar tudo do cliente</button></div>
              </div>
            </section>
            <section className="glass p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div><div className="label-mono">HISTÓRICO DE COMPRAS</div><h2 className="mt-1 text-xl font-bold text-heading">Compras e pagamentos</h2></div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" aria-expanded={dateFilterOpen} onClick={() => setDateFilterOpen((open) => !open)} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${appliedDateFilter ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/70 text-muted-foreground hover:bg-secondary"}`}>
                    <SlidersHorizontal className="h-4 w-4" />Filtrar data
                  </button>
                  <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Filtrar compras do cliente">
                  {(["todos", "pendentes", "quitados"] as const).map((option) => (
                    <button key={option} type="button" role="radio" aria-checked={purchaseFilter === option} onClick={() => setPurchaseFilter(option)} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${purchaseFilter === option ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/70 text-muted-foreground hover:bg-secondary"}`}>
                      <span className={`grid h-4 w-4 place-items-center rounded-[5px] border ${purchaseFilter === option ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50 bg-background"}`}>{purchaseFilter === option ? <span className="text-[10px] leading-none">✓</span> : null}</span>
                      {option === "todos" ? "Todos" : option === "pendentes" ? "Pendente" : "Quitado"}
                    </button>
                  ))}
                  </div>
                </div>
              </div>
              {dateFilterOpen && (
                <div className="mb-4 rounded-xl border border-border bg-background/70 p-3">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => setDateFilterMode("month")} className={`rounded-lg px-3 py-2 text-xs font-semibold ${dateFilterMode === "month" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>Mês</button>
                    <button type="button" onClick={() => setDateFilterMode("custom")} className={`rounded-lg px-3 py-2 text-xs font-semibold ${dateFilterMode === "custom" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>Data personalizada</button>
                  </div>
                  {dateFilterMode === "month" ? (
                    <label className="block max-w-xs text-xs font-semibold text-muted-foreground">Mês
                      <input type="month" value={monthDraft} onChange={(event) => setMonthDraft(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
                    </label>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs font-semibold text-muted-foreground">Data inicial
                        <input type="date" value={startDateDraft} max={endDateDraft || undefined} onChange={(event) => setStartDateDraft(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
                      </label>
                      <label className="text-xs font-semibold text-muted-foreground">Data final
                        <input type="date" value={endDateDraft} min={startDateDraft || undefined} onChange={(event) => setEndDateDraft(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
                      </label>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => { setMonthDraft(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; }); setStartDateDraft(""); setEndDateDraft(""); setAppliedDateFilter(null); }} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground">Limpar</button>
                    <button type="button" onClick={() => { setAppliedDateFilter(dateFilterMode === "month" ? (monthDraft ? { mode: "month", month: monthDraft, start: "", end: "" } : null) : (startDateDraft || endDateDraft ? { mode: "custom", month: "", start: startDateDraft, end: endDateDraft } : null)); setDateFilterOpen(false); }} className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground">Aplicar filtro</button>
                  </div>
                </div>
              )}
              <div className="space-y-3">
                {[...selectedSales].filter((sale) => {
                  const matchesPurchase = purchaseFilter === "todos" || (purchaseFilter === "pendentes" ? remaining(sale) > 0 : remaining(sale) <= 0);
                  if (!matchesPurchase || !appliedDateFilter) return matchesPurchase;
                  const date = new Date(sale.date);
                  if (Number.isNaN(date.getTime())) return false;
                  if (appliedDateFilter.mode === "month") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` === appliedDateFilter.month;
                  const saleDay = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                  return (!appliedDateFilter.start || saleDay >= appliedDateFilter.start) && (!appliedDateFilter.end || saleDay <= appliedDateFilter.end);
                }).sort((a,b) => +new Date(b.date)-+new Date(a.date)).map((s) => {
                  const paidAmount=paidTotal(s), due=remaining(s), draft=paymentValue;
                  return <article key={s.id} className="rounded-xl border-2 border-black bg-background/50 p-4 shadow-sm">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3"><div><div className={`font-semibold ${due > 0 ? "text-amber-500" : "text-green-600"}`}>{new Date(s.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</div></div><div className="text-right"><div className="text-sm text-green-600">Pago: R$ {brl(paidAmount)}</div><div className={`font-semibold ${due > 0 ? "text-orange-600" : "text-green-600"}`}>Pendente: R$ {brl(due)}</div></div></div>
                    <div className="overflow-x-auto rounded-xl border border-border/70">
                      <table className="w-full min-w-[480px] text-sm">
                        <thead className="bg-secondary/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <tr>
                            <th className="px-3 py-3 font-bold">Data/hora</th>
                            <th className="px-3 py-3 font-bold">Produtos</th>
                            <th className="px-3 py-3 text-right font-bold">Quantidade</th>
                            <th className="px-3 py-3 text-right font-bold">Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.items.map((item, index) => (
                            <tr key={index} className="border-t border-border/60">
                              <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{new Date(s.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                              <td className="px-3 py-3 font-medium text-heading">{item.name}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-right">{item.qty} {item.unit === "kg" ? "kg" : "un"}</td>
                              <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">R$ {brl(item.price * item.qty)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-border bg-secondary/40">
                            <td colSpan={3} className="px-3 py-3 text-right font-bold text-heading">Total da compra</td>
                            <td className="whitespace-nowrap px-3 py-3 text-right font-display text-lg font-bold text-heading">R$ {brl(s.total)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    {due>0 && <div className="mt-3 rounded-xl bg-background/60 p-2.5"><div className="flex flex-wrap items-center gap-2"><div className="relative w-[116px] shrink-0"><span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">R$</span><input aria-label="Valor do pagamento" inputMode="decimal" value={draft} onChange={e=>setPaymentValue(formatMoneyInput(e.target.value))} placeholder="0,00" className="w-full rounded-lg border border-border bg-background py-2.5 pl-8 pr-2 text-sm font-bold text-center outline-none focus:border-primary"/></div><div className="flex min-w-0 flex-1 items-center gap-1.5">{([{value:"cash",label:"Dinheiro"},{value:"card",label:"Cartão"},{value:"pix",label:"Pix"}] as const).map(method=><button key={method.value} type="button" aria-pressed={paymentMethod===method.value} onClick={()=>setPaymentMethod(method.value)} className={`min-h-11 flex-1 rounded-lg border px-2 py-2.5 text-sm font-bold transition-colors ${paymentMethod===method.value ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-background text-muted-foreground hover:bg-secondary"}`}>{method.label}</button>)}</div><button onClick={()=>{const value=Number(draft.replace(/\\./g,"").replace(",","."));if(Number.isFinite(value)&&value>0&&value<=due+0.005){if(paymentMethod==="pix"){const key=settings.pixKey?.trim();if(!key){setPasswordError("Cadastre a chave Pix em Gerência → Configurações.");return;}setPixPayment({payments:[{saleId:s.id,amount:value}],amount:value,payload:buildPixPayload(key,value,settings.companyName||"MOBFLOW")});}else{void confirmFiadoChange(async()=>{await actions.addFiadoPayment(s.id,value,paymentMethod);setPaymentValue("");});}}}} disabled={!draft || !(Number(draft.replace(/\\./g,"").replace(",","."))>0) || Number(draft.replace(/\\./g,"").replace(",","."))>due+0.005} className="min-h-11 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50 sm:w-auto">Confirmar pagamento</button></div><button onClick={()=>{if(paymentMethod==="pix"){const key=settings.pixKey?.trim();if(!key){setPasswordError("Cadastre a chave Pix em Gerência → Configurações.");return;}setPixPayment({payments:[{saleId:s.id,amount:due}],amount:due,payload:buildPixPayload(key,due,settings.companyName||"MOBFLOW")});}else{void confirmFiadoChange(async()=>{await actions.addFiadoPayment(s.id,due,paymentMethod);setPaymentValue("");});}}} className="mt-2 rounded-lg bg-green-500/15 px-3 py-2 text-xs font-bold text-green-700">Quitar esta compra</button></div>}
                    <div className="mt-4"><div className="mb-2"><span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pagamentos já feitos</span></div>{(s.payments??[]).length>0?<div className="max-w-xl space-y-2">{(s.payments??[]).map((p,i)=><div key={i} className="grid grid-cols-[1fr_auto] items-center rounded-xl bg-background/70 px-4 py-3"><span className="text-sm text-muted-foreground">{new Date(p.date).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}<span className="ml-2 font-semibold text-foreground">{p.method === "cash" ? "Dinheiro" : p.method === "card" ? "Cartão" : p.method === "pix" ? "Pix" : "Forma não informada"}</span>{p.syncStatus === "pending" && <span className="ml-2 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700">Aguardando sincronização</span>}</span><span className="font-display text-xl font-bold text-green-600">R$ {brl(p.value)}</span></div>)}</div>:<div className="text-sm text-muted-foreground">Nenhum pagamento registrado ainda.</div>}</div>
                    <div className="mt-4 flex justify-end"><button onClick={()=>printReceipt(s)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent"><ReceiptText className="mr-1 inline h-4 w-4 text-green-600" />Imprimir compra</button></div>
                  </article>;
                })}
              </div>
            </section>
          </>
        )}

      {pixPayment && (
        <div className="fixed inset-0 z-[65] grid place-items-center bg-background/85 p-4 backdrop-blur-sm" onClick={() => setPixPayment(null)}>
          <div className="mfb-in w-full max-w-sm rounded-2xl bg-popover p-5 text-center ring-1 ring-primary/40 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="font-mono text-[11px] uppercase tracking-[.18em] text-primary">PAGAMENTO PIX DO FIADO</div>
            <h2 className="mt-2 font-display text-2xl tracking-[.06em] text-heading">ESCANEIE PARA PAGAR</h2>
            <p className="mt-2 font-display text-4xl text-primary">R$ {brl(pixPayment.amount)}</p>
            <div className="mx-auto mt-4 w-fit rounded-2xl bg-white p-3 ring-1 ring-border">
              <img src={`https://quickchart.io/qr?size=280&text=${encodeURIComponent(pixPayment.payload)}`} alt="QR Code Pix do pagamento do fiado" className="h-60 w-60" />
            </div>
            <p className="mt-3 break-all font-mono text-[10px] text-muted-foreground">Chave: {settings.pixKey}</p>
            <p className="mt-2 text-xs text-muted-foreground">Após receber o Pix, confirme para registrar o pagamento no histórico do cliente.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setPixPayment(null)} className="flex-1 rounded-xl bg-secondary py-3 text-sm font-semibold text-secondary-foreground">Cancelar</button>
              <button type="button" onClick={() => { const payment = pixPayment; setPixPayment(null); void confirmFiadoChange(async () => { for (const item of payment.payments) await actions.addFiadoPayment(item.saleId,item.amount,"pix"); setPaymentValue(""); if(selectedCustomer && payment.payments.length>1) setSettledReceipt({customer:selectedCustomer,amount:payment.amount}); }); }} className="flex-1 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground">Confirmar recebimento</button>
            </div>
          </div>
        </div>
      )}
      {confirmDialogOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-background/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md glass p-6 shadow-2xl">
            <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-amber-500/10"><LockKeyhole className="h-5 w-5 text-amber-600" /></div>
            <h2 className="text-xl font-bold text-heading">Confirmar ação</h2>
            <p className="mt-2 text-sm text-muted-foreground">{confirmDialogMessage}</p>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => { setConfirmDialogOpen(false); setPendingConfirmation(null); }} className="flex-1 rounded-xl bg-secondary px-4 py-3 text-sm font-semibold text-secondary-foreground">Cancelar</button>
              <button type="button" onClick={continueFiadoConfirmation} className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">Continuar</button>
            </div>
          </div>
        </div>
      )}
      {settledReceipt && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-background/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md glass p-6 shadow-2xl">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-green-500/15"><ReceiptText className="h-6 w-6 text-green-600" /></div>
            <h2 className="text-center text-xl font-bold text-heading">Fiado quitado com sucesso</h2>
            <p className="mt-2 text-center text-sm text-muted-foreground">Cliente: {settledReceipt.customer}</p>
            <div className="mt-5 rounded-xl bg-green-500/10 p-4 text-center">
              <div className="text-xs font-bold uppercase tracking-wide text-green-700">Total pago</div>
              <div className="mt-1 font-display text-3xl font-bold text-green-600">R$ {brl(settledReceipt.amount)}</div>
            </div>
            <div className="mt-5"><button onClick={() => setSettledReceipt(null)} className="w-full rounded-xl bg-secondary px-4 py-3 text-sm font-semibold text-secondary-foreground">Fechar comprovante</button></div>
          </div>
        </div>
      )}
      {passwordModalOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-background/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <form onSubmit={(e) => { e.preventDefault(); void submitFiadoPassword(); }} className="w-full max-w-md glass p-6 shadow-2xl">
            <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-primary/10"><LockKeyhole className="h-5 w-5 text-primary" /></div>
            <h2 className="text-xl font-bold text-heading">{offlineAuthorizationBlocked ? "Sessão offline não autorizada" : "Confirmar senha do usuário"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{offlineAuthorizationBlocked ? "Por segurança, o recebimento não foi registrado. A sessão PDV salva precisa estar válida e pertencer a este operador e empresa." : "Para confirmar esta alteração no fiado, digite novamente a senha do usuário do PDV."}</p>
            {!offlineAuthorizationBlocked && <input type="password" value={passwordInput} onChange={e => { setPasswordInput(e.target.value); setPasswordError(""); }} placeholder="Senha do usuário" autoComplete="current-password" autoFocus className="field mt-4 w-full text-foreground" />}
            {passwordError && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{passwordError}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => { setPasswordModalOpen(false); setPasswordInput(""); setPasswordError(""); setPendingChange(null); setOfflineAuthorizationBlocked(false); }} className="flex-1 rounded-xl bg-secondary px-4 py-3 text-sm font-semibold text-secondary-foreground">{offlineAuthorizationBlocked ? "Fechar" : "Cancelar"}</button>
              {!offlineAuthorizationBlocked && <button type="submit" disabled={authorizing} className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{authorizing ? "Validando..." : "Confirmar"}</button>}
            </div>
          </form>
        </div>
      )}
      </main>
    </div>
  );
}