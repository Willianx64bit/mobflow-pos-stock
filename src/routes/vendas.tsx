import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { brl, useStore } from "@/lib/store";

export const Route = createFileRoute("/vendas")({
  head: () => ({
    meta: [
      { title: "MobFlow — Histórico de Vendas" },
      { name: "description", content: "Veja as vendas do dia, faturamento e formas de pagamento no MobFlow." },
      { property: "og:title", content: "MobFlow — Histórico de Vendas" },
      { property: "og:description", content: "Faturamento e histórico de vendas do seu PDV." },
    ],
  }),
  component: Vendas,
});

function Vendas() {
  const sales = useStore((s) => s.sales);
  const today = new Date().toDateString();
  const todays = sales.filter((s) => new Date(s.date).toDateString() === today);
  const sum = (arr: typeof sales) => arr.reduce((t, s) => t + s.total, 0);
  const byPay = (["Dinheiro", "Cartão", "Pix"] as const).map((m) => [m, sum(todays.filter((s) => s.payment === m))] as const);

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        <div className="glass p-4"><div className="label-mono">Faturamento hoje</div><div className="font-display text-4xl mt-1 text-primary">R$ {brl(sum(todays))}</div></div>
        <div className="glass p-4"><div className="label-mono">Vendas hoje</div><div className="font-display text-4xl mt-1 text-heading">{todays.length}</div></div>
        {byPay.map(([m, v]) => (
          <div key={m} className="glass p-4"><div className="label-mono">{m}</div><div className="font-display text-4xl mt-1 text-heading">R$ {brl(v)}</div></div>
        ))}
      </div>
      <section className="glass p-4">
        <div className="label-mono mb-3">Histórico</div>
        <div className="divide-y divide-border/50">
          {sales.length === 0 && <p className="py-10 text-center font-mono text-[11px] text-muted-foreground">nenhuma venda ainda</p>}
          {sales.map((s) => (
            <div key={s.id} className="py-3 flex flex-wrap items-center gap-4 text-[13px]">
              <span className="font-mono text-[11px] text-muted-foreground w-36">{new Date(s.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
              <span className="flex-1 min-w-48 text-foreground truncate">{s.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</span>
              <span className="font-mono text-[11px] rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">{s.payment}</span>
              <span className="font-mono text-heading w-28 text-right">R$ {brl(s.total)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
