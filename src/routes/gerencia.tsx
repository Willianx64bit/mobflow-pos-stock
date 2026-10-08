import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FormEvent, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { brl, useStore } from "@/lib/store";

const managementTabs = [
  { to: "/estoque", label: "Estoque", icon: "▣" },
  { to: "/vendas", label: "Vendas", icon: "▤" },
  { to: "/recebimento", label: "Recebimento", icon: "⇩" },
  { to: "/configuracoes", label: "Configurações", icon: "⚙" },
] as const;

const localDateKey = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
};

function saleProfit(s: { total: number; profit?: number; items: { name: string; cost?: number; qty: number }[] }, products: { name: string; cost?: number }[]) {
  if (typeof s.profit === "number") return s.profit;
  const costTotal = s.items.reduce((sum, item) => {
    const product = products.find((p) => p.name === item.name);
    return sum + (item.cost ?? product?.cost ?? 0) * item.qty;
  }, 0);
  return s.total - costTotal;
}

export const Route = createFileRoute("/gerencia")({
  head: () => ({ meta: [{ title: "MobFlow — Gerência" }] }),
  component: Gerencia,
});

function Gerencia() {
  const navigate = useNavigate();
  const products = useStore((s) => s.products);
  const sales = useStore((s) => s.sales);
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const today = localDateKey();
  const todays = sales.filter((s) => localDateKey(new Date(s.date)) === today);
  const todaySales = todays.reduce((sum, s) => sum + s.total, 0);
  const todayProfit = todays.reduce((sum, s) => sum + saleProfit(s, products), 0);
  const low = products.filter((p) => p.stock <= p.minStock).sort((a, b) => a.stock - b.stock).slice(0, 6);

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== "gerencia123") {
      setError("Senha da gerência incorreta.");
      setPassword("");
      return;
    }
    setUnlocked(true);
    setPassword("");
  };

  if (!unlocked) {
    return (
      <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
        <AppHeader />
        <section className="min-h-[calc(100vh-7rem)] grid place-items-center">
          <div className="w-full max-w-md rounded-2xl bg-surface ring-1 ring-border p-6 sm:p-8">
            <div className="text-center">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/15 ring-1 ring-primary/40 grid place-items-center font-display text-3xl text-primary">M</div>
              <div className="mt-4 font-display tracking-[.18em] text-3xl text-heading">MOBFLOW</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">GERÊNCIA</div>
            </div>
            <form onSubmit={handleLogin} className="mt-7 space-y-4">
              <input value={password} onChange={(e) => setPassword(e.target.value)} autoFocus type="password" placeholder="Senha da gerência" className="field w-full text-foreground" />
              {error && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{error}</div>}
              <button type="submit" className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground">Entrar na gerência</button>
            </form>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
      <AppHeader />
      <main className="space-y-5">
        <div>
          <div className="font-mono text-xs uppercase tracking-[.16em] text-muted-foreground">GERÊNCIA</div>
          <h1 className="mt-1 font-display text-4xl tracking-wide text-heading">Resumo rápido da operação de hoje.</h1>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-5 ring-1 ring-border"><div className="text-sm text-muted-foreground">Vendas de hoje</div><div className="mt-2 font-display text-4xl text-heading">{brl(todaySales)}</div></div>
          <div className="rounded-2xl bg-white p-5 ring-1 ring-border"><div className="text-sm text-muted-foreground">Lucro de hoje</div><div className="mt-2 font-display text-4xl text-heading">{brl(todayProfit)}</div></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {managementTabs.map((tab) => (
            <button key={tab.to} onClick={() => navigate({ to: tab.to })} className="rounded-2xl bg-white p-5 text-left ring-1 ring-border transition hover:ring-primary/50">
              <div className="text-2xl text-primary">{tab.icon}</div><div className="mt-3 font-bold text-heading">{tab.label}</div>
            </button>
          ))}
        </div>
        <section className="rounded-2xl bg-white p-5 ring-1 ring-border">
          <div className="font-bold text-heading">Estoque baixo</div>
          {low.length === 0 ? <div className="mt-3 text-sm text-muted-foreground">Nenhum produto com estoque baixo.</div> : (
            <div className="mt-3 divide-y divide-border">{low.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-3 text-sm"><span className="font-medium text-heading">{p.name}</span><span className="font-mono text-muted-foreground">{p.stock} / mín. {p.minStock}</span></div>
            ))}</div>
          )}
        </section>
      </main>
    </div>
  );
}
