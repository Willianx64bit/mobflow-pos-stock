import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, brl, printFiadoBalance, printReceipt, useStore, type Sale } from "@/lib/store";

export const Route = createFileRoute("/fiado/$customer")({
  head: () => ({ meta: [{ title: "MobFlow — Detalhes do cliente" }] }),
  component: FiadoCliente,
});

function formatMoneyInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return (Number(digits) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function FiadoCliente() {
  const { customer: encodedCustomer } = useParams({ from: "/fiado/$customer" });
  const navigate = useNavigate();
  const sales = useStore((s) => s.sales);
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, string>>({});
  const customer = decodeURIComponent(encodedCustomer || "");
  const customerSales = useMemo(
    () => sales.filter((s) => s.payment === "Fiado" && (s.customer || "Cliente não informado").trim() === customer.trim()).sort((a, b) => +new Date(b.date) - +new Date(a.date)),
    [sales, customer],
  );
  const paidTotal = (s: Sale) => (s.payments ?? (s.paid ? [{ value: s.total, date: s.paidAt ?? s.date }] : [])).reduce((sum, p) => sum + p.value, 0);
  const remaining = (s: Sale) => Math.max(0, s.total - paidTotal(s));
  const balance = customerSales.reduce((sum, s) => sum + remaining(s), 0);
  const paid = balance <= 0;

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
                  <div className="w-full rounded-xl border border-border/70">
                    <table className="w-full table-fixed text-xs sm:text-sm">
                      <thead className="bg-secondary/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="w-[27%] px-1.5 py-2 font-bold sm:px-3 sm:py-3">Data/hora</th>
                          <th className="w-[33%] px-1.5 py-2 font-bold sm:px-3 sm:py-3">Produtos</th>
                          <th className="w-[20%] px-1.5 py-2 text-right font-bold sm:px-3 sm:py-3">Quantidade</th>
                          <th className="w-[20%] px-1.5 py-2 text-right font-bold sm:px-3 sm:py-3">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.items.map((item, index) => (
                          <tr key={index} className="border-t border-border/60">
                            <td className="break-words px-1.5 py-2 text-muted-foreground sm:px-3 sm:py-3">{new Date(s.date).toLocaleDateString("pt-BR")}<span className="block">{new Date(s.date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></td>
                            <td className="break-words px-1.5 py-2 font-medium text-heading sm:px-3 sm:py-3">{item.name}</td>
                            <td className="break-words px-1.5 py-2 text-right sm:px-3 sm:py-3">{item.qty} {item.unit === "kg" ? "kg" : "un"}</td>
                            <td className="break-words px-1.5 py-2 text-right font-semibold sm:px-3 sm:py-3">R$ {brl(item.price * item.qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-border bg-secondary/40">
                          <td colSpan={3} className="px-1.5 py-2 text-right font-bold text-heading sm:px-3 sm:py-3">Total da compra</td>
                          <td className="break-words px-1.5 py-2 text-right font-display text-sm font-bold text-heading sm:px-3 sm:py-3 sm:text-lg">R$ {brl(s.total)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-x-5 gap-y-1 text-sm text-muted-foreground">
                    <span>Pago: <strong className="text-heading">R$ {brl(paidAmount)}</strong></span>
                    <span className={`font-bold ${due > 0 ? "text-orange-600" : "text-green-600"}`}>Falta pagar: R$ {brl(due)}</span>
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
