import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { brl, useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";

const managementTabs = [
  { to: "/estoque", label: "Estoque", icon: "□" },
  { to: "/vendas", label: "Vendas", icon: "↗" },
  { to: "/recebimento", label: "Recebimento", icon: "↓" },
  { to: "/configuracoes", label: "Configurações", icon: "⚙" },
] as const;

const localDateKey = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
};
const isoToday = () => localDateKey();
const firstDayOfMonth = () => {
  const d = new Date();
  return localDateKey(new Date(d.getFullYear(), d.getMonth(), 1));
};

function saleProfit(s: { total: number; profit?: number; items: { name: string; price: number; cost?: number | undefined; qty: number }[] }, products: { name: string; cost?: number | undefined }[]) {
  if (typeof s.profit === "number") return s.profit;
  const costTotal = s.items.reduce((sum, i) => {
    const savedCost = i.cost;
    const fallbackCost = products.find((p) => p.name === i.name)?.cost;
    const cost = savedCost ?? fallbackCost;
    return sum + (cost ?? 0) * i.qty;
  }, 0);
  return s.total - costTotal;
}

export const Route = createFileRoute("/gerencia")({
  head: () => ({ meta: [{ title: "MobFlow — Acesso Gerência" }] }),
  component: Gerencia,
});

function Gerencia() {
  const navigate = useNavigate();
  const products = useStore((s) => s.products);
  const sales = useStore((s) => s.sales);
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("mobflow-management") === "1");
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [from] = useState(firstDayOfMonth);
  const [to] = useState(isoToday);

  const today = isoToday();
  const todays = useMemo(() => sales.filter((s) => localDateKey(new Date(s.date)) === today), [sales, today]);
  const todaySales = todays.reduce((sum, s) => sum + s.total, 0);
  const todayProfit = todays.reduce((sum, s) => sum + saleProfit(s, products), 0);
  const low = useMemo(() => products.filter((p) => p.stock <= p.minStock).sort((a, b) => a.stock - b.stock), [products]);
  const recent = sales.slice(0, 5);

  const periodSales = useMemo(() => sales.filter((s) => {
    const day = localDateKey(new Date(s.date));
    return day >= from && day <= to;
  }), [sales, from, to]);
  const periodTotal = periodSales.reduce((sum, s) => sum + s.total, 0);
  const periodProfit = periodSales.reduce((sum, s) => sum + saleProfit(s, products), 0);

  const enter = async () => {
    setCheckingAccess(true);
    setError("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Faça login na conta para acessar a gerência.");
      setCheckingAccess(false);
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("username").eq("id", user.id).maybeSingle();
    if (profile?.username !== "TESTE.MOBFLOW") {
      setError("Esta conta não tem acesso à gerência.");
      setCheckingAccess(false);
      return;
    }
    const data = new TextEncoder().encode(password);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hash !== "ffdb88d3c5bb1a79855f2a675ed200e39ae49a19319c8c3410bbc74bc10a49f9") {
      setError("Senha da gerência incorreta.");
      setCheckingAccess(false);
      return;
    }
    sessionStorage.setItem("mobflow-management", "1");
    setUnlocked(true);
    setPassword("");
    setCheckingAccess(false);
  };

  const lock = () => {
    sessionStorage.removeItem("mobflow-management");
    sessionStorage.removeItem("mobflow-management-pass-hash");
    sessionStorage.removeItem("mobflow-management-user");
    setUnlocked(false);
  };

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="space-y-5">
        {!unlocked ? (
          <section className="min-h-[calc(100vh-7rem)] grid place-items-center">
            <div className="w-full max-w-sm glass p-6 text-center">
              <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-primary/15 ring-1 ring-primary/40 grid place-items-center text-2xl">🔒</div>
              <h1 className="font-display text-2xl tracking-[.12em] text-heading">ACESSO GERÊNCIA</h1>
              <p className="mt-2 text-sm text-muted-foreground">Digite a senha para continuar.</p>
              <input
                autoFocus
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") void enter(); }}
                placeholder="Senha da gerência"
                className="field mt-4 w-full text-sm text-foreground"
              />
              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
              <button onClick={() => void enter()} disabled={checkingAccess || !password} className="mt-5 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">{checkingAccess ? "Verificando..." : "Entrar na gerência"}</button>
              <button onClick={() => navigate({ to: "/" })} className="mt-2 w-full rounded-xl bg-secondary px-4 py-3 text-sm text-secondary-foreground hover:bg-accent">Voltar</button>
            </div>
          </section>
        ) : (
          <>
            <section className="glass p-5 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                <div>
                  <div className="flex items-center gap-2"><span className="text-xl">📊</span><h1 className="font-display text-2xl tracking-[.1em] text-heading">DASHBOARD</h1></div>
                  <p className="text-sm text-muted-foreground mt-1">Resumo rápido da operação de hoje.</p>
                </div>
                <button onClick={() => navigate({ to: "/dashboard" })} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground hover:bg-accent">
                  Ver mais detalhes
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 max-w-xl mx-auto">
                <div className="aspect-square rounded-full bg-secondary/60 p-5 ring-1 ring-border/60 flex flex-col items-center justify-center text-center shadow-sm">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Vendas de hoje</div>
                  <div className="mt-2 text-2xl font-bold text-heading">R$ {brl(todaySales)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{todays.length} venda(s)</div>
                </div>
                <div className="aspect-square rounded-full bg-secondary/60 p-5 ring-1 ring-border/60 flex flex-col items-center justify-center text-center shadow-sm">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Lucro de hoje</div>
                  <div className="mt-2 text-2xl font-bold text-primary">R$ {brl(todayProfit)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">somente lucro das vendas</div>
                </div>
                <div className="col-span-2 mx-auto mt-1 w-full max-w-[260px] rounded-2xl bg-secondary/60 p-4 ring-1 ring-border/60 text-center">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Estoque baixo</div>
                  <div className="mt-2 text-2xl font-bold text-destructive">{low.length}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{low.length ? "produto(s) precisam de reposição" : "nenhum alerta no momento"}</div>
                </div>
              </div>

              <div className="mt-5 grid lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-3"><h2 className="font-semibold text-heading">Últimas vendas</h2><p className="text-xs text-muted-foreground mt-0.5">Máximo de 5 movimentações</p></div>
                  {recent.length === 0 ? <div className="py-5 text-sm text-muted-foreground">Nenhuma venda registrada.</div> : <button onClick={() => navigate({ to: "/vendas" })} className="w-full text-left"><div className="divide-y divide-border/50">{recent.map((s) => <div key={s.id} className="py-2.5 flex items-center gap-3"><div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{s.customer || s.items.map((i) => i.name).join(", ")}</div><div className="text-xs text-muted-foreground">{new Date(s.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {s.payment}</div></div><div className="text-sm font-semibold">R$ {brl(s.total)}</div></div>)}</div></button>}
                </div>
                <div className="rounded-2xl border border-border/60 p-4">
                  <div className="mb-3"><h2 className="font-semibold text-heading">⚠️ Estoque baixo</h2><p className="text-xs text-muted-foreground mt-0.5">Produtos no mínimo ou abaixo dele</p></div>
                  {low.length === 0 ? <div className="py-5 text-sm text-muted-foreground">Estoque em dia.</div> : <button onClick={() => navigate({ to: "/estoque" })} className="w-full text-left"><div className="divide-y divide-border/50">{low.slice(0, 5).map((p) => <div key={p.id} className="py-2.5 flex items-center justify-between gap-3"><span className="text-sm truncate">{p.name}</span><span className="text-sm font-semibold text-destructive">{p.unit === "kg" ? brl(p.stock) + " kg" : p.stock} <span className="text-xs font-normal text-muted-foreground">/ mín. {p.unit === "kg" ? brl(p.minStock) + " kg" : p.minStock}</span></span></div>)}</div></button>}
                  {low.length > 5 && <div className="mt-3 text-xs text-muted-foreground">+ {low.length - 5} produto(s) com estoque baixo</div>}
                </div>
              </div>

            </section>

            <section className="glass p-5 md:p-6">
              <div className="mb-4"><h2 className="font-display text-xl tracking-[.08em] text-heading">GERÊNCIA</h2><p className="text-sm text-muted-foreground mt-1">Acesse as outras áreas administrativas.</p></div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {managementTabs.map((tab) => <button key={tab.to} onClick={() => navigate({ to: tab.to })} className="rounded-2xl bg-secondary/70 ring-1 ring-border p-5 text-left hover:bg-accent transition-colors"><div className="text-2xl">{tab.icon}</div><div className="mt-3 font-semibold text-heading">{tab.label}</div><div className="mt-1 text-xs text-muted-foreground">Acessar</div></button>)}
              </div>
              <button onClick={lock} className="mt-4 rounded-xl bg-secondary px-4 py-2.5 text-sm text-secondary-foreground hover:bg-accent">🔒 Bloquear gerência</button>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
