import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";

const managementTabs = [
  { to: "/dashboard", label: "Dashboard", icon: "▥" },
  { to: "/estoque", label: "Estoque", icon: "□" },
  { to: "/vendas", label: "Vendas", icon: "↗" },
  { to: "/recebimento", label: "Recebimento", icon: "↓" },
] as const;

export const Route = createFileRoute("/gerencia")({
  head: () => ({ meta: [{ title: "MobFlow — Acesso Gerência" }] }),
  component: Gerencia,
});

function Gerencia() {
  const navigate = useNavigate();
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("mobflow-management") === "1");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const enter = () => {
    if (password === "gerencia123") {
      sessionStorage.setItem("mobflow-management", "1");
      setUnlocked(true);
      setError("");
      return;
    }
    setError("Senha de gerência incorreta.");
  };

  const lock = () => {
    sessionStorage.removeItem("mobflow-management");
    setUnlocked(false);
    setPassword("");
  };

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="min-h-[calc(100vh-3rem)] grid place-items-center">
        {!unlocked ? (
          <section className="w-full max-w-sm glass p-6 text-center">
            <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-primary/15 ring-1 ring-primary/40 grid place-items-center text-2xl">🔒</div>
            <h1 className="font-display text-2xl tracking-[.12em] text-heading">ACESSO GERÊNCIA</h1>
            <p className="mt-2 text-sm text-muted-foreground">Digite a senha para acessar as opções de gerência.</p>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") enter(); }}
              placeholder="Senha de gerência"
              className="mt-5 w-full rounded-xl border border-border bg-background px-3 py-3 text-center outline-none focus:ring-2 focus:ring-primary"
            />
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            <button onClick={enter} className="mt-4 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground hover:opacity-90">
              Entrar na gerência
            </button>
            <button onClick={() => navigate({ to: "/" })} className="mt-2 w-full rounded-xl bg-secondary px-4 py-3 text-sm text-secondary-foreground hover:bg-accent">
              Voltar
            </button>
          </section>
        ) : (
          <section className="w-full max-w-3xl glass p-6">
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <div className="flex-1">
                <h1 className="font-display text-2xl tracking-[.12em] text-heading">GERÊNCIA</h1>
                <p className="text-sm text-muted-foreground mt-1">Selecione uma área para continuar.</p>
              </div>
              <button onClick={lock} className="rounded-xl bg-secondary px-4 py-2.5 text-sm text-secondary-foreground hover:bg-accent">🔒 Bloquear</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {managementTabs.map((tab) => (
                <button key={tab.to} onClick={() => navigate({ to: tab.to })} className="rounded-2xl bg-secondary/70 ring-1 ring-border p-5 text-left hover:bg-accent transition-colors">
                  <div className="text-2xl">{tab.icon}</div>
                  <div className="mt-3 font-semibold text-heading">{tab.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Acessar</div>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
