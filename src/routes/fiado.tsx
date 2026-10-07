import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { actions, brl, printFiadoBalance, printReceipt, useStore, type Sale } from "@/lib/store";

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
  const formatMoneyInput = (value: string) => { const digits = value.replace(/\D/g, ""); if (!digits) return ""; return (Number(digits) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  const fiado = useMemo(() => sales.filter((s) => s.payment === "Fiado"), [sales]);
  const customers = useMemo(() => {
    const map = new Map<string, Sale[]>();
    fiado.forEach((s) => {
      const name = (s.customer || "Cliente não informado").trim();
      map.set(name, [...(map.get(name) || []), s]);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [fiado]);
  const paidTotal = (s: Sale) => (s.payments ?? (s.paid ? [{ value: s.total, date: s.paidAt ?? s.date }] : [])).reduce((sum, p) => sum + p.value, 0);
  const remaining = (s: Sale) => Math.max(0, s.total - paidTotal(s));
  const visibleCustomers = useMemo(() => customers.filter(([customer, customerSales]) => { const matchesSearch = customer.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()); const balance = customerSales.reduce((sum, s) => sum + remaining(s), 0); const matchesFilter = filter === "todos" || (filter === "pendentes" ? balance > 0 : balance <= 0); return matchesSearch && matchesFilter; }), [customers, search, filter]);
  const open = fiado.filter((s) => remaining(s) > 0);
  const totalOpen = open.reduce((sum, s) => sum + remaining(s), 0);

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="space-y-4">
        <section className="glass p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="label-mono">CONTAS EM ABERTO</div>
              <h1 className="mt-1 font-display text-3xl tracking-[.1em] text-heading">FIADO</h1>
              <p className="mt-1 text-sm text-muted-foreground">{customers.length} cliente(s) · {open.length} compra(s) pendente(s)</p>
            </div>
            <div className="text-right">
              <div className="label-mono">SALDO TOTAL</div>
              <div className="font-display text-3xl text-destructive">R$ {brl(totalOpen)}</div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <section className="glass p-4"><div className="grid gap-3 md:grid-cols-[1fr_auto]"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar cliente..." className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" /><div className="flex gap-2">{(["todos", "pendentes", "pagos"] as const).map((item) => <button key={item} onClick={() => setFilter(item)} className={`rounded-xl px-4 py-2 text-xs font-bold ${filter === item ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-accent"}`}>{item === "todos" ? "Todos" : item === "pendentes" ? "Pendentes" : "Pagos"}</button>)}</div></div></section>
          {customers.length === 0 && <div className="glass p-8 text-center text-sm text-muted-foreground">Nenhum fiado registrado.</div>}
          {visibleCustomers.map(([customer, customerSales]) => {
            const total = customerSales.reduce((sum, s) => sum + remaining(s), 0);
            const customerPending = total > 0;
            const key = customer;
            const isOpen = expanded === key;
            return (
              <div key={key} className="glass p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${customerPending ? "bg-orange-500/15 text-orange-600 ring-1 ring-orange-500/30" : "bg-green-500/15 text-green-600 ring-1 ring-green-500/30"}`}>{customerPending ? "Pendente" : "Pago"}</span>
                      <div className="text-lg font-bold text-heading">{customer}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{customerSales.length} compra(s) · {customerSales.filter((s) => remaining(s) > 0).length} pendente(s)</div>
                  </div>
                  <div className="text-right"><div className="font-display text-2xl text-destructive">R$ {brl(total)}</div><div className="text-[11px] text-muted-foreground">saldo restante</div></div>
                  <button onClick={() => navigate({ to: "/fiado/$customer", params: { customer: encodeURIComponent(customer) } })} className="rounded-lg bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20">👤 Ver cliente</button>
                  <button onClick={() => printFiadoBalance(customer, customerSales.concat(sales.filter(s => s.payment === "Fiado" && s.paid && (s.customer || "").trim() === customer.trim())))} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent">🖨 Imprimir saldo</button>
                </div>

                {isOpen && (
                  <div className="mt-4 divide-y divide-border/50 rounded-xl bg-secondary/40 px-3">
                    {[...customerSales].sort((a, b) => +new Date(b.date) - +new Date(a.date)).map((s) => (
                      <div key={s.id} className="py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-foreground">{new Date(s.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{s.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono font-bold text-heading">R$ {brl(s.total)}</div>
                            <div className="text-[11px] text-muted-foreground">Pago: R$ {brl(paidTotal(s))} · Saldo: R$ {brl(remaining(s))}</div>
                          </div>
                          {remaining(s) > 0 ? <div className="basis-full mt-2 rounded-xl border border-border/60 bg-background/60 p-4"><div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Registrar pagamento</div><div className="flex flex-wrap items-center gap-3"><div className="font-display text-4xl text-heading">R$ {brl(remaining(s))}</div><div className="text-xs text-muted-foreground">falta pagar</div><input inputMode="decimal" value={paymentValue} onChange={(e) => setPaymentValue(formatMoneyInput(e.target.value))} placeholder="0,00" className="w-36 rounded-xl border-2 border-border bg-background px-4 py-3 text-lg font-bold text-center outline-none focus:border-primary" /><button onClick={() => { const value = Number(paymentValue.replace(/\./g, "").replace(",", ".")); if (Number.isFinite(value) && value > 0) { actions.addFiadoPayment(s.id, value); setPaymentValue(""); } }} className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground hover:opacity-90">Adicionar pagamento</button><button onClick={() => { actions.addFiadoPayment(s.id, remaining(s)); setPaymentValue(""); }} className="rounded-xl bg-green-500/15 px-4 py-3 text-sm font-bold text-green-600">Quitar tudo</button></div></div> : <span className="rounded-full bg-green-500/15 px-2.5 py-1 text-[11px] font-bold text-green-600 ring-1 ring-green-500/30">Pago</span>}
                          <button onClick={() => printReceipt(s)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent">🧾 Compra</button>
                          {(s.payments ?? []).length > 0 && <div className="basis-full pl-1 text-[11px] text-muted-foreground">Pagamentos: {(s.payments ?? []).map((p, i) => <span key={i} className="ml-2">R$ {brl(p.value)} ({new Date(p.date).toLocaleDateString("pt-BR")})</span>)}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
