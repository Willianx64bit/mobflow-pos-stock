import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FormEvent, useEffect, useMemo, useState } from "react";
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
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("mobflow-management") === "1");
  const [password, setPassword] = useState("");
  const [details, setDetails] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));

  useEffect(() => {
    const syncLock = () => setUnlocked(sessionStorage.getItem("mobflow-management") === "1");
    window.addEventListener("mobflow-management-changed", syncLock);
    return () => window.removeEventListener("mobflow-management-changed", syncLock);
  }, []);

  const lockManagement = () => {
    sessionStorage.removeItem("mobflow-management");
    sessionStorage.removeItem("mobflow-management-password");
    setUnlocked(false);
    window.dispatchEvent(new Event("mobflow-management-changed"));
  };
  const [error, setError] = useState("");

  const today = localDateKey();
  const todays = sales.filter((s) => localDateKey(new Date(s.date)) === today);
  const todaySales = todays.reduce((sum, s) => sum + s.total, 0);
  const todayProfit = todays.reduce((sum, s) => sum + saleProfit(s, products), 0);
  const low = products.filter((p) => p.stock <= p.minStock).sort((a, b) => a.stock - b.stock).slice(0, 6);
  const periodSales = useMemo(() => sales.filter((s) => new Date(s.date).toISOString().slice(0, 7) === selectedMonth), [sales, selectedMonth]);
  const periodTotal = periodSales.reduce((sum, s) => sum + s.total, 0);
  const periodProfit = periodSales.reduce((sum, s) => sum + saleProfit(s, products), 0);
  const monthLabel = new Date(selectedMonth + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== "gerencia123") {
      setError("Senha da gerência incorreta.");
      setPassword("");
      return;
    }
    sessionStorage.setItem("mobflow-management", "1");
    sessionStorage.setItem("mobflow-management-password", "gerencia123");
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-xs uppercase tracking-[.16em] text-muted-foreground">GERÊNCIA</div>
            <h1 className="mt-1 font-display text-4xl tracking-wide text-heading">Resumo rápido da operação de hoje.</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setDetails((v) => !v)} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground ring-1 ring-border hover:bg-accent">
              {details ? "Fechar detalhes" : "Ver mais detalhes"}
            </button>
            <button onClick={lockManagement} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground ring-1 ring-border hover:bg-accent">
              🔒 Bloquear gerência
            </button>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="relative overflow-hidden rounded-full bg-white p-7 ring-1 ring-border shadow-[0_0_32px_rgba(56,189,248,0.22)] aspect-square max-w-[280px] mx-auto w-full flex flex-col items-center justify-center text-center">
            <div className="absolute -inset-2 rounded-full border-[10px] border-sky-200/35 blur-[3px] animate-[spin_18s_linear_infinite] pointer-events-none" />
            <div className="absolute inset-4 rounded-full border border-dashed border-sky-300/40 animate-[spin_26s_linear_infinite_reverse] pointer-events-none" />
            <div className="text-sm text-muted-foreground">Vendas de hoje</div><div className="mt-2 font-display text-4xl text-heading">{brl(todaySales)}</div>
          </div>
          <div className="relative overflow-hidden rounded-full bg-white p-7 ring-1 ring-border shadow-sm aspect-square max-w-[280px] mx-auto w-full flex flex-col items-center justify-center text-center">
            <div className="absolute -inset-3 rounded-full border-[8px] border-sky-200/20 blur-[6px] animate-[spin_24s_linear_infinite] pointer-events-none" />\n            <div className="absolute -inset-1 rounded-full border-[5px] border-sky-300/45 blur-[2px] shadow-[0_0_28px_rgba(56,189,248,0.42)] animate-[spin_18s_linear_infinite_reverse] pointer-events-none" />\n            <div className="absolute inset-4 rounded-full border border-dashed border-sky-300/35 animate-[spin_30s_linear_infinite] pointer-events-none" />\n            <div className="text-sm text-muted-foreground">Lucro de hoje</div><div className="mt-2 font-display text-4xl text-heading">{brl(todayProfit)}</div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {managementTabs.map((tab) => (
            <button key={tab.to} onClick={() => navigate({ to: tab.to })} className="rounded-2xl bg-white p-5 text-left ring-1 ring-border transition hover:ring-primary/50">
              <div className="text-2xl text-primary">{tab.icon}</div><div className="mt-3 font-bold text-heading">{tab.label}</div>
            </button>
          ))}
        </div>
        {details && (
          <section className="rounded-2xl bg-white p-5 ring-1 ring-border">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><div className="font-bold text-heading">Detalhes por mês</div><div className="mt-1 text-sm text-muted-foreground">Consulte vendas e lucro de qualquer mês.</div></div>
              <label className="text-xs font-medium text-muted-foreground">Filtrar mês<input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="mt-1 block rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" /></label>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100"><div className="text-xs uppercase tracking-wider text-muted-foreground">Vendas</div><div className="mt-1 text-xl font-bold text-heading">{brl(periodTotal)}</div><div className="text-xs text-muted-foreground">{periodSales.length} venda(s)</div></div>
              <div className="rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100"><div className="text-xs uppercase tracking-wider text-muted-foreground">Lucro</div><div className="mt-1 text-xl font-bold text-primary">{brl(periodProfit)}</div><div className="text-xs text-muted-foreground">somente lucro das vendas</div></div>
              <div className="rounded-xl bg-sky-50 p-4 ring-1 ring-sky-100"><div className="text-xs uppercase tracking-wider text-muted-foreground">Mês selecionado</div><div className="mt-1 text-xl font-bold capitalize text-heading">{monthLabel}</div><div className="text-xs text-muted-foreground">filtro aplicado</div></div>
            </div>
            {periodSales.length > 0 && <div className="mt-4 divide-y divide-border/50">{periodSales.map((s) => <div key={s.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{s.customer || s.items.map((i) => i.name).join(", ")}</div><div className="text-xs text-muted-foreground">{new Date(s.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {s.payment}</div></div><div className="text-right"><div className="text-sm font-semibold text-heading">{brl(s.total)}</div><div className="text-xs text-primary">Lucro {brl(saleProfit(s, products))}</div></div></div>)}</div>}
            {periodSales.length === 0 && <div className="mt-4 rounded-xl bg-secondary/50 p-4 text-center text-sm text-muted-foreground">Nenhuma venda registrada em {monthLabel}.</div>}
          </section>
        )}
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
