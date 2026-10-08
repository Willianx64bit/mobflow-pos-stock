import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LoginScreen } from "@/components/LoginScreen";
import { brl, useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";

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
  const [unlocked, setUnlocked] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [error, setError] = useState("");
  const [from] = useState(firstDayOfMonth);
  const [to] = useState(isoToday);

  useEffect(() => {
    setUnlocked(sessionStorage.getItem("mobflow-management") === "1");
  }, []);


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

  const lock = () => {
    sessionStorage.removeItem("mobflow-management");
    sessionStorage.removeItem("mobflow-management-pass-hash");
    sessionStorage.removeItem("mobflow-management-user");
    setUnlocked(false);
  };

  return (
    <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
      <AppHeader />
      <main className="space-y-5">
        {!unlocked ? (
          <section className="min-h-[calc(100vh-7rem)] grid place-items-center">
            <div className="w-full max-w-md">
              <LoginScreen mode="empresa" onLogin={() => void handleManagerLogin()} />
            </div>
          </section>
        ) : (
          <>
            <section className="glass border-sky-100/80 bg-white/85 p-5 shadow-[0_12px_40px_rgba(56,189,248,0.08)] md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                <div>
                  <p className="text-sm font-medium text-slate-600">Resumo rápido da operação de hoje.</p>
                </div>
                <button onClick={() => navigate({ to: "/dashboard" })} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-medium text-secondary-foreground hover:bg-accent">
                  Ver mais detalhes
                </button>
              </div>

              <div className="grid grid-cols-2 gap-5 max-w-xl mx-auto">
                <div className="relative aspect-square rounded-full bg-white p-3 shadow-[0_12px_35px_rgba(56,189,248,0.10)] ring-1 ring-sky-100">
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-sky-300 border-r-sky-200 animate-[spin_7s_linear_infinite]" />
                  <div className="absolute inset-2 rounded-full border border-sky-100" />
                  <div className="relative h-full rounded-full bg-sky-50/70 flex flex-col items-center justify-center text-center">
                    <div className="text-[11px] uppercase tracking-[.14em] text-sky-600">Vendas de hoje</div>
                    <div className="mt-2 text-2xl font-bold text-slate-800">R$ {brl(todaySales)}</div>
                    <div className="mt-1 text-xs text-slate-500">{todays.length} venda(s)</div>
                  </div>
                </div>
                <div className="relative aspect-square rounded-full bg-white p-3 shadow-[0_12px_35px_rgba(56,189,248,0.10)] ring-1 ring-sky-100">
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-sky-300 border-r-sky-200 animate-[spin_7s_linear_infinite_reverse]" />
                  <div className="absolute inset-2 rounded-full border border-sky-100" />
                  <div className="relative h-full rounded-full bg-sky-50/70 flex flex-col items-center justify-center text-center">
                    <div className="text-[11px] uppercase tracking-[.14em] text-sky-600">Lucro de hoje</div>
                    <div className="mt-2 text-2xl font-bold text-sky-700">R$ {brl(todayProfit)}</div>
                    <div className="mt-1 text-xs text-slate-500">somente lucro das vendas</div>
                  </div>
                </div>
                <div className="col-span-2 mx-auto mt-1 w-full max-w-[260px] rounded-2xl bg-sky-50 p-4 ring-1 ring-sky-100 text-center shadow-sm">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Estoque baixo</div>
                  <div className="mt-2 text-2xl font-bold text-destructive">{low.length}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{low.length ? "produto(s) precisam de reposição" : "nenhum alerta no momento"}</div>
                </div>
              </div>

              <div className="mt-5 grid lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-sky-100 bg-sky-50/20 p-4">
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
                {managementTabs.map((tab) => <button key={tab.to} onClick={() => navigate({ to: tab.to })} className="group rounded-2xl bg-sky-50/80 ring-1 ring-sky-100 p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-sky-100/80 hover:shadow-md"><div className="grid h-11 w-11 place-items-center rounded-xl bg-sky-100 text-xl text-sky-600 transition-transform duration-200 group-hover:scale-105">{tab.icon}</div><div className="mt-3 font-semibold text-heading">{tab.label}</div><div className="mt-1 text-xs text-muted-foreground">Acessar</div></button>)}
              </div>
              <button onClick={lock} className="mt-4 rounded-xl bg-secondary px-4 py-2.5 text-sm text-secondary-foreground hover:bg-accent">🔒 Bloquear gerência</button>
            </section>
          </>
        )}
      </main>
    </div>
  );
}  useEffect(() => {
    let active = true;
    const checkManager = async () => {
      if (sessionStorage.getItem("mobflow-management") === "1") {
        if (active) setUnlocked(true);
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from("profiles").select("role,active").eq("id", user.id).maybeSingle();
      if (active && profile?.role === "manager" && profile.active !== false) {
        sessionStorage.setItem("mobflow-management", "1");
        setUnlocked(true);
      }
    };
    void checkManager();
    return () => { active = false; };
  }, []);

  const handleManagerLogin = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Não foi possível iniciar a sessão da gerência.");
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("role,active").eq("id", user.id).maybeSingle();
    if (profile?.role !== "manager" || profile.active === false) {
      await supabase.auth.signOut();
      localStorage.removeItem("mobflow-authenticated");
      sessionStorage.removeItem("mobflow-role");
      sessionStorage.removeItem("mobflow-username");
      setError("Esse usuário não possui acesso à gerência.");
      return;
    }
    sessionStorage.setItem("mobflow-management", "1");
    await hydrateStore();
    setUnlocked(true);
    setError("");
  };
