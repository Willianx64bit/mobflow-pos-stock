import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, brl, printFiadoBalance, printReceipt, useStore, type Sale } from "@/lib/store";

export const Route = createFileRoute("/fiado/cliente")({
  head: () => ({ meta: [{ title: "MobFlow — Detalhes do cliente" }] }),
  component: FiadoCliente,
});

function formatMoneyInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return (Number(digits) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function FiadoCliente() {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState("");
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("nome") || "Cliente não informado";
    setCustomer(value);
  }, []);
  const sales = useStore((s) => s.sales);
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, string>>({});
  const customerSales = useMemo(
    () => sales.filter((s) => s.payment === "Fiado" && (s.customer || "Cliente não informado").trim() === customer.trim()).sort((a, b) => +new Date(b.date) - +new Date(a.date)),
    [sales, customer],
  );
  const paidTotal = (s: Sale) => (s.payments ?? (s.paid ? [{ value: s.total, date: s.paidAt ?? s.date }] : [])).reduce((sum, p) => sum + p.value, 0);
  const remaining = (s: Sale) => Math.max(0, s.total - paidTotal(s));
  const balance = customerSales.reduce((sum, s) => sum + remaining(s), 0);
  const paid = balance <= 0;
  const totalPurchased = customerSales.reduce((sum, s) => sum + s.total, 0);

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="mx-auto max-w-5xl space-y-4">
        <button onClick={() => navigate({ to: "/fiado" })} className="rounded-xl bg-secondary px-4 py-2 text-sm font-semibold hover:bg-accent">← Voltar para Fiado</button>

        <section className="glass p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="label-mono">DETALHES DO CLIENTE</div>
              <div className="mt-1 flex items-center gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${paid ? "bg-green-500/15 text-green-600 ring-1 ring-green-500/30" : "bg-orange-500/15 text-orange-600 ring-1 ring-orange-500/30"}`}>{paid ? "Pago" : "Pendente"}</span>
                <h1 className="font-display text-3xl tracking-[.06em] text-heading">{customer}</h1>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{customerSales.length} compra(s) no histórico · Total comprado: R$ {brl(totalPurchased)}</p>
            </div>
            <div className="text-right">
              <div className="label-mono">SALDO RESTANTE</div>
              <div className={`font-display text-4xl ${paid ? "text-green-600" : "text-destructive"}`}>R$ {brl(balance)}</div>
              <button onClick={() => printFiadoBalance(customer, customerSales)} className="mt-2 rounded-lg bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent">🖨 Imprimir saldo</button>
            </div>
          </div>
        </section>

        <section className="glass p-5">
          <div className="mb-4">
            <div className="label-mono">HISTÓRICO DE COMPRAS</div>
            <h2 className="mt-1 text-xl font-bold text-heading">Compras e pagamentos</h2>
          </div>

          <div className="space-y-4">
            {customerSales.map((s) => {
              const paidAmount = paidTotal(s);
              const due = remaining(s);
              const draft = paymentDrafts[s.id] ?? "";
              return (
                <article key={s.id} className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                  <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                    <div>
                      <div className="text-sm font-semibold text-heading">{new Date(s.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</div>
                      <div className="mt-2 text-sm text-muted-foreground">{s.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</div>
                    </div>
                    <div className="text-left md:text-right">
                      <div className="font-display text-2xl text-heading">R$ {brl(s.total)}</div>
                      <div className="mt-1 text-sm text-muted-foreground">Pago: <strong>R$ {brl(paidAmount)}</strong></div>
                      <div className={`text-sm font-bold ${due > 0 ? "text-orange-600" : "text-green-600"}`}>Saldo: R$ {brl(due)}</div>
                    </div>
                  </div>

                  {due > 0 && (
                    <div className="mt-4 rounded-2xl border border-border/60 bg-background/60 p-4">
                      <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center">
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Falta pagar</div>
                          <div className="mt-1 font-display text-4xl text-heading">R$ {brl(due)}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            inputMode="decimal"
                            value={draft}
                            onChange={(e) => setPaymentDrafts((prev) => ({ ...prev, [s.id]: formatMoneyInput(e.target.value) }))}
                            placeholder="0,00"
                            className="w-40 rounded-xl border-2 border-border bg-background px-4 py-3 text-lg font-bold text-center outline-none focus:border-primary"
                          />
                          <button
                            onClick={() => {
                              const value = Number(draft.replace(/\./g, "").replace(",", "."));
                              if (Number.isFinite(value) && value > 0) {
                                actions.addFiadoPayment(s.id, value);
                                setPaymentDrafts((prev) => ({ ...prev, [s.id]: "" }));
                              }
                            }}
                            className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground hover:opacity-90"
                          >Adicionar pagamento</button>
                          <button
                            onClick={() => {
                              actions.addFiadoPayment(s.id, due);
                              setPaymentDrafts((prev) => ({ ...prev, [s.id]: "" }));
                            }}
                            className="rounded-xl bg-green-500/15 px-4 py-3 text-sm font-bold text-green-600"
                          >Quitar tudo</button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-4">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Pagamentos já feitos</div>
                    {(s.payments ?? []).length > 0 ? (
                      <div className="max-w-xl space-y-2">
                        {(s.payments ?? []).map((p, i) => (
                          <div key={i} className="grid grid-cols-[1fr_auto] items-center rounded-xl bg-background/70 px-4 py-3">
                            <span className="text-sm text-muted-foreground">{new Date(p.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                            <span className="font-display text-xl font-bold text-green-600">R$ {brl(p.value)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">Nenhum pagamento registrado ainda.</div>
                    )}
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button onClick={() => printReceipt(s)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold hover:bg-accent">🧾 Imprimir compra</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
