import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { brl, useStore } from "@/lib/store";

const localDateKey = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
};

const todayKey = () => localDateKey();

const firstDayOfMonth = () => {
  const d = new Date();
  return localDateKey(new Date(d.getFullYear(), d.getMonth(), 1));
};

function saleProfit(s: { total: number; items: { price: number; cost?: number; qty: number }[] }) {
  const costTotal = s.items.reduce((sum, i) => sum + (i.cost ?? 0) * i.qty, 0);
  return Math.max(0, s.total - costTotal);
}

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "MobFlow — Detalhes da Gerência" }] }),
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const products = useStore((s) => s.products);
  const sales = useStore((s) => s.sales);
  const [from, setFrom] = useState(firstDayOfMonth);
  const [to, setTo] = useState(todayKey);

  useEffect(() => {
    if (sessionStorage.getItem("mobflow-management") !== "1") {
      navigate({ to: "/gerencia" });
    }
  }, [navigate]);

  const low = useMemo(
    () => products.filter((p) => p.stock <= p.minStock).sort((a, b) => a.stock - b.stock),
    [products],
  );

  const periodSales = useMemo(() => sales.filter((s) => {
    const day = localDateKey(new Date(s.date));
    return day >= from && day <= to;
  }), [sales, from, to]);

  const periodTotal = periodSales.reduce((sum, s) => sum + s.total, 0);
  const periodProfit = periodSales.reduce((sum, s) => sum + saleProfit(s), 0);

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="space-y-5">
        <section className="glass p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">📊</span>
                <h1 className="font-display text-2xl tracking-[.1em] text-heading">DETALHES</h1>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Consulte vendas, lucro e estoque por período.</p>
            </div>
            <button onClick={() => navigate({ to: "/gerencia" })} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground hover:bg-accent">
              ← Voltar para gerência
            </button>
          </div>

          <div className="rounded-2xl border border-border/60 p-4 md:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
              <div>
                <h2 className="font-semibold text-heading">Vendas por período</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Use as datas para consultar qualquer mês ou intervalo.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="text-xs text-muted-foreground">De
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground" />
                </label>
                <label className="text-xs text-muted-foreground">Até
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground" />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div className="rounded-xl bg-secondary/60 p-4">
                <div className="text-xs text-muted-foreground">Vendas no período</div>
                <div className="mt-1 text-xl font-bold text-heading">R$ {brl(periodTotal)}</div>
                <div className="text-xs text-muted-foreground">{periodSales.length} venda(s)</div>
              </div>
              <div className="rounded-xl bg-secondary/60 p-4">
                <div className="text-xs text-muted-foreground">Lucro no período</div>
                <div className="mt-1 text-xl font-bold text-primary">R$ {brl(periodProfit)}</div>
                <div className="text-xs text-muted-foreground">somente lucro dos produtos</div>
              </div>
            </div>

            {periodSales.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Nenhuma venda encontrada nesse período.</div>
            ) : (
              <div className="divide-y divide-border/50">
                {periodSales.map((s) => (
                  <div key={s.id} className="py-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{s.customer || s.items.map((i) => i.name).join(", ")}</div>
                      <div className="text-xs text-muted-foreground">{new Date(s.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {s.payment}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-heading">R$ {brl(s.total)}</div>
                      <div className="text-xs text-primary">Lucro R$ {brl(saleProfit(s))}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="glass p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">⚠️</span>
                <h2 className="font-display text-xl tracking-[.08em] text-heading">ESTOQUE BAIXO</h2>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Aqui aparecem todos os produtos que estão no mínimo ou abaixo dele.</p>
            </div>
            <button onClick={() => navigate({ to: "/estoque" })} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground hover:bg-accent">
              Ver estoque completo
            </button>
          </div>

          {low.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Nenhum produto precisa de reposição.</div>
          ) : (
            <div className="divide-y divide-border/50">
              {low.map((p) => (
                <div key={p.id} className="py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-heading truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.category || "Sem categoria"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-destructive">
                      {p.unit === "kg" ? brl(p.stock) + " kg" : p.stock}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      mínimo {p.unit === "kg" ? brl(p.minStock) + " kg" : p.minStock}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
