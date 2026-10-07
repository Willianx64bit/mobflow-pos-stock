import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, brl, printFiadoBalance, printReceipt, useStore, type Sale } from "@/lib/store";

export const Route = createFileRoute("/fiado")({
  head: () => ({ meta: [{ title: "MobFlow — Fiado" }] }),
  component: Fiado,
});

function Fiado() {
  const navigate = useNavigate();
  const sales = useStore((s) => s.sales);
  const [expanded, setExpanded] = useState<string | null>(null);

  const open = useMemo(() => sales.filter((s) => s.payment === "Fiado" && !s.paid), [sales]);
  const customers = useMemo(() => {
    const map = new Map<string, Sale[]>();
    open.forEach((s) => {
      const name = (s.customer || "Cliente não informado").trim();
      map.set(name, [...(map.get(name) || []), s]);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [open]);
  const totalOpen = open.reduce((sum, s) => sum + s.total, 0);

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="space-y-4">
        <section className="glass p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="label-mono">CONTAS EM ABERTO</div>
              <h1 className="mt-1 font-display text-3xl tracking-[.1em] text-heading">FIADO</h1>
              <p className="mt-1 text-sm text-muted-foreground">{customers.length} cliente(s) · {open.length} compra(s) em aberto</p>
            </div>
            <div className="text-right">
              <div className="label-mono">SALDO TOTAL</div>
              <div className="font-display text-3xl text-destructive">R$ {brl(totalOpen)}</div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          {customers.length === 0 && <div className="glass p-8 text-center text-sm text-muted-foreground">Nenhum fiado em aberto. Tudo pago. ✓</div>}
          {customers.map(([customer, customerSales]) => {
            const total = customerSales.reduce((sum, s) => sum + s.total, 0);
            const key = customer;
            const isOpen = expanded === key;
            return (
              <div key={key} className="glass p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-bold text-heading">{customer}</div>
                    <div className="text-xs text-muted-foreground">{customerSales.length} compra(s) em aberto</div>
                  </div>
                  <div className="font-display text-2xl text-destructive">R$ {brl(total)}</div>
                  <button onClick={() => setExpanded(isOpen ? null : key)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent">🧾 Detalhar compra</button>
                  <button onClick={() => printFiadoBalance(customer, customerSales.concat(sales.filter(s => s.payment === "Fiado" && s.paid && (s.customer || "").trim() === customer.trim())))} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent">🖨 Imprimir saldo</button>
                </div>

                {isOpen && (
                  <div className="mt-4 divide-y divide-border/50 rounded-xl bg-secondary/40 px-3">
                    {customerSales.map((s) => (
                      <div key={s.id} className="py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-foreground">{new Date(s.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{s.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</div>
                          </div>
                          <div className="font-mono font-bold text-heading">R$ {brl(s.total)}</div>
                          <button onClick={() => { if (confirm(`Confirmar que ${customer} pagou R$ ${brl(s.total)}?`)) actions.markFiadoPaid(s.id); }} className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground">✓ Marcar pago</button>
                          <button onClick={() => printReceipt(s)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent">🧾 Compra</button>
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
