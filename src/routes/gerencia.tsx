import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { brl, useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { verifyManagerPassword } from "@/lib/manager-auth";

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
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [details, setDetails] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));

  useEffect(() => {
    const syncLock = () => setUnlocked(sessionStorage.getItem("mobflow-management") === "1");
    window.addEventListener("mobflow-management-changed", syncLock);
    return () => window.removeEventListener("mobflow-management-changed", syncLock);
  }, []);

  const lockManagement = () => {
    sessionStorage.removeItem("mobflow-management");
    setUnlocked(false);
    window.dispatchEvent(new Event("mobflow-management-changed"));
  };
  const [error, setError] = useState("");
  const [checkingManager, setCheckingManager] = useState(true);
  const [accessIssue, setAccessIssue] = useState("");

  const today = localDateKey();
  const todays = sales.filter((s) => localDateKey(new Date(s.date)) === today);
  const todaySales = todays.reduce((sum, s) => sum + s.total, 0);
  const todayProfit = todays.reduce((sum, s) => sum + saleProfit(s, products), 0);
  const low = products.filter((p) => p.stock <= p.minStock).sort((a, b) => a.stock - b.stock).slice(0, 6);
  const periodSales = useMemo(() => sales.filter((s) => new Date(s.date).toISOString().slice(0, 7) === selectedMonth), [sales, selectedMonth]);
  const periodTotal = periodSales.reduce((sum, s) => sum + s.total, 0);
  const periodProfit = periodSales.reduce((sum, s) => sum + saleProfit(s, products), 0);
  const monthLabel = new Date(selectedMonth + "-01T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  useEffect(() => {
    let active = true;
    const checkManager = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          if (active) {
            setAccessIssue("Sua sessão não está ativa. Entre novamente com a conta da empresa para acessar a Gerência.");
            setCheckingManager(false);
          }
          return;
        }
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role,active")
          .eq("id", sessionData.session.user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!profile || profile.active === false) {
          if (active) {
            setAccessIssue("A conta conectada não está ativa ou não tem permissão para acessar o sistema. Entre com uma conta ativa e tente novamente.");
            setCheckingManager(false);
          }
          return;
        }
        if (active) {
          setAccessIssue("");
          setCheckingManager(false);
        }
      } catch {
        if (active) {
          setAccessIssue("Não foi possível confirmar a permissão da sua conta. Verifique a conexão e tente novamente.");
          setCheckingManager(false);
        }
      }
    };
    void checkManager();
    return () => { active = false; };
  }, []);

  const confirmManagerPassword = async () => {
    setPasswordError("");
    if (password.length < 6) {
      setPasswordError("Informe a senha da gerência.");
      return;
    }
    setPasswordLoading(true);
    const result = await verifyManagerPassword(password);
    setPasswordLoading(false);
    if (!result.ok) {
      setPasswordError(result.error || "Senha da gerência incorreta.");
      return;
    }
    sessionStorage.setItem("mobflow-management", "1");
    setUnlocked(true);
    setPassword("");
  };

  if (checkingManager) {
    return <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6"><AppHeader /><section className="min-h-[calc(100vh-7rem)] grid place-items-center"><div className="text-sm text-muted-foreground">Carregando gerência...</div></section></div>;
  }

  if (accessIssue) {
    return (
      <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
        <AppHeader />
        <section className="min-h-[calc(100vh-7rem)] grid place-items-center">
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 ring-1 ring-border sm:p-8">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/15 text-2xl ring-1 ring-amber-500/30">🔒</div>
            <h1 className="mt-4 text-center font-display text-2xl text-heading">Acesso à Gerência</h1>
            <p className="mt-3 text-center text-sm leading-6 text-muted-foreground">{accessIssue}</p>
            <div className="mt-6 grid gap-2">
              <button type="button" onClick={() => navigate({ to: "/" })} className="w-full rounded-xl bg-secondary py-3 font-semibold text-secondary-foreground ring-1 ring-border">Voltar ao PDV</button>
              <button type="button" onClick={async () => {
                await supabase.auth.signOut();
                localStorage.removeItem("mobflow-authenticated");
                sessionStorage.removeItem("mobflow-role");
                sessionStorage.removeItem("mobflow-username");
                sessionStorage.removeItem("mobflow-pdv-authorized");
                sessionStorage.removeItem("mobflow-management");
                window.dispatchEvent(new Event("mobflow-auth-changed"));
                navigate({ to: "/" });
              }} className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground">Sair e entrar com a conta da empresa</button>
            </div>
          </div>
        </section>
      </div>
    );
  }

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
            <div className="mt-7 space-y-4">
              <div className="rounded-xl bg-secondary/60 p-4 text-center text-sm text-muted-foreground">Sua conta está autenticada. Digite a senha da gerência para abrir esta área.</div>
              {error && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{error}</div>}
              <div className="mt-4 space-y-3">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") void confirmManagerPassword(); }}
                  placeholder="Senha da gerência"
                  autoComplete="current-password"
                  className="field w-full text-foreground"
                  autoFocus
                />
                {passwordError && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{passwordError}</div>}
                <button type="button" onClick={() => void confirmManagerPassword()} disabled={passwordLoading} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground disabled:opacity-50">
                  {passwordLoading ? "Validando..." : "Confirmar senha"}
                </button>
              </div>
            </div>
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
          <div className="relative overflow-visible rounded-full bg-sky-50 p-7 ring-1 ring-sky-300/70 shadow-[0_0_42px_rgba(56,189,248,0.28)] aspect-square max-w-[280px] mx-auto w-full flex flex-col items-center justify-center text-center">
            <div className="absolute -inset-4 rounded-full border-[12px] border-sky-300/25 blur-[8px] shadow-[0_0_38px_rgba(56,189,248,0.28)] pointer-events-none" />
            <div className="absolute -inset-1 rounded-full border-[4px] border-sky-400/45 shadow-[0_0_18px_rgba(56,189,248,0.34)] pointer-events-none" />
            <div className="relative text-sm text-muted-foreground">Vendas de hoje</div><div className="relative mt-2 font-display text-4xl text-heading">{brl(todaySales)}</div>
          </div>
          <div className="relative overflow-visible rounded-full bg-sky-50 p-7 ring-1 ring-sky-300/70 shadow-[0_0_42px_rgba(56,189,248,0.28)] aspect-square max-w-[280px] mx-auto w-full flex flex-col items-center justify-center text-center">
            <div className="absolute -inset-4 rounded-full border-[12px] border-sky-300/25 blur-[8px] shadow-[0_0_38px_rgba(56,189,248,0.28)] pointer-events-none" />
            <div className="absolute -inset-1 rounded-full border-[4px] border-sky-400/45 shadow-[0_0_18px_rgba(56,189,248,0.34)] pointer-events-none" />
            <div className="relative text-sm text-muted-foreground">Lucro de hoje</div><div className="relative mt-2 font-display text-4xl text-heading">{brl(todayProfit)}</div>
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
