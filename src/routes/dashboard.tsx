import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { brl, useStore } from "@/lib/store";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "MobFlow — Dashboard" }] }),
  component: Dashboard,
});

function Dashboard() {
  const products = useStore((s) => s.products);
  const sales = useStore((s) => s.sales);
  const today = new Date().toDateString();
  const todays = sales.filter((s) => new Date(s.date).toDateString() === today);
  const stockValue = products.reduce((sum, p) => sum + p.stock * p.price, 0);
  const todayTotal = todays.reduce((sum, s) => sum + s.total, 0);
  const low = products.filter((p) => p.stock <= p.minStock).sort((a, b) => a.stock - b.stock);
  const recent = sales.slice(0, 8);
  const soldItems = todays.reduce((sum, s) => sum + s.items.reduce((n, i) => n + i.qty, 0), 0);

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="space-y-4">
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="glass p-4"><div className="label-mono">Valor em estoque</div><div className="mt-1 text-2xl font-semibold text-heading">R$ {brl(stockValue)}</div><div className="mt-1 text-xs text-muted-foreground">{products.length} produtos cadastrados</div></div>
          <div className="glass p-4"><div className="label-mono">Estoque baixo</div><div className="mt-1 text-2xl font-semibold text-destructive">{low.length}</div><div className="mt-1 text-xs text-muted-foreground">precisam de reposição</div></div>
          <div className="glass p-4"><div className="label-mono">Vendas hoje</div><div className="mt-1 text-2xl font-semibold text-heading">{todays.length}</div><div className="mt-1 text-xs text-muted-foreground">{soldItems} itens vendidos</div></div>
          <div className="glass p-4"><div className="label-mono">Faturamento hoje</div><div className="mt-1 text-2xl font-semibold text-primary">R$ {brl(todayTotal)}</div><div className="mt-1 text-xs text-muted-foreground">vendas realizadas hoje</div></div>
        </section>

        <section className="grid lg:grid-cols-2 gap-4">
          <div className="glass p-4">
            <div className="mb-3"><h2 className="font-semibold text-heading">Estoque baixo</h2><p className="text-xs text-muted-foreground mt-0.5">Produtos que chegaram ao mínimo</p></div>
            {low.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">Nenhum produto precisa de reposição.</div> : (
              <div className="divide-y divide-border/50">{low.slice(0, 8).map((p) => (
                <div key={p.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium text-foreground truncate">{p.name}</div><div className="text-xs text-muted-foreground">{p.category}</div></div>
                  <div className="text-right"><div className="text-sm font-semibold text-destructive">{p.unit === "kg" ? brl(p.stock) + " kg" : p.stock}</div><div className="text-[10px] text-muted-foreground">mín. {p.unit === "kg" ? brl(p.minStock) + " kg" : p.minStock}</div></div>
                </div>
              ))}</div>
            )}
          </div>

          <div className="glass p-4">
            <div className="mb-3"><h2 className="font-semibold text-heading">Vendas recentes</h2><p className="text-xs text-muted-foreground mt-0.5">Últimas movimentações do PDV</p></div>
            {recent.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">Nenhuma venda registrada.</div> : (
              <div className="divide-y divide-border/50">{recent.map((s) => (
                <div key={s.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium text-foreground truncate">{s.customer || s.items.map((i) => i.name).join(", ")}</div><div className="text-xs text-muted-foreground">{new Date(s.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {s.payment}</div></div>
                  <div className="text-sm font-semibold text-heading">R$ {brl(s.total)}</div>
                </div>
              ))}</div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
