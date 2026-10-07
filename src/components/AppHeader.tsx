import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

const publicTabs = [
  { to: "/", label: "PDV", key: "F2", icon: "▣" },
  { to: "/conferencia", label: "Conferência", key: "F7", icon: "✓" },
] as const;

const managementTabs = [
  { to: "/dashboard", label: "Dashboard", key: "F1", icon: "▥" },
  { to: "/estoque", label: "Estoque", key: "F3", icon: "□" },
  { to: "/vendas", label: "Vendas", key: "F4", icon: "↗" },
  { to: "/recebimento", label: "Recebimento", key: "F8", icon: "↓" },
] as const;

export function AppHeader() {
  const navigate = useNavigate();
  const [time, setTime] = useState("");
  const [open, setOpen] = useState(() => localStorage.getItem("mobflow-sidebar") !== "closed");
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("mobflow-theme") === "dark");
  const [managementUnlocked, setManagementUnlocked] = useState(() => sessionStorage.getItem("mobflow-management") === "1");
  const [managementPrompt, setManagementPrompt] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("mobflow-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const t = setInterval(tick, 15000);
    const onKey = (e: KeyboardEvent) => {
      const allTabs = managementUnlocked ? [...publicTabs, ...managementTabs] : publicTabs;
      const tab = allTabs.find((t) => t.key === e.key);
      if (tab) {
        e.preventDefault();
        navigate({ to: tab.to });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [navigate, managementUnlocked]);

  const closeSidebar = () => {
    localStorage.setItem("mobflow-sidebar", "closed");
    setOpen(false);
  };

  const selectTab = (to: (typeof publicTabs | typeof managementTabs)[number]["to"]) => {
    localStorage.setItem("mobflow-sidebar", "closed");
    setOpen(false);
    navigate({ to });
  };

  const toggleSidebar = () => setOpen((value) => {
    const next = !value;
    localStorage.setItem("mobflow-sidebar", next ? "open" : "closed");
    return next;
  });

  const openManagement = () => {
    if (managementUnlocked) { selectTab("/dashboard"); return; }
    setPassword(""); setPasswordError(""); setManagementPrompt(true);
  };

  const unlockManagement = () => {
    if (password === "gerencia123") {
      sessionStorage.setItem("mobflow-management", "1");
      setManagementUnlocked(true); setManagementPrompt(false); setPassword("");
    } else setPasswordError("Senha de gerência incorreta.");
  };

  const lockManagement = () => {
    sessionStorage.removeItem("mobflow-management");
    setManagementUnlocked(false);
  };

  return (
    <>
      {open ? (
        <aside className="fixed left-0 top-0 z-50 h-screen w-64 transition-transform duration-200">
          <div className="h-full bg-popover/95 backdrop-blur-xl ring-r-1 ring-border flex flex-col">
            <div className="h-20 flex items-center px-4 gap-3">
              <div className="h-9 w-9 shrink-0 rounded-xl bg-primary/15 ring-1 ring-primary/40 grid place-items-center font-display text-xl text-primary">M</div>
              <div className="leading-none min-w-0">
                <div className="font-display tracking-[.18em] text-[20px] text-heading">MOBFLOW</div>
                <div className="font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">PDV + ESTOQUE</div>
              </div>
            </div>

            <nav className="flex-1 px-2 space-y-1">
              {publicTabs.map((t) => (
                <button key={t.to} type="button" onClick={() => selectTab(t.to)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground">
                  <span className="w-6 text-center text-base">{t.icon}</span><span className="flex-1 text-left">{t.label}</span><kbd className="font-mono text-[10px] opacity-60">{t.key}</kbd>
                </button>
              ))}
              <button type="button" onClick={openManagement} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground">
                <span className="w-6 text-center text-base">🔒</span><span className="flex-1 text-left">Acesso Gerência</span>
              </button>
              {managementUnlocked && (
                <>
                  <div className="px-3 pt-4 pb-1 font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Gerência</div>
                  {managementTabs.map((t) => (
                    <button key={t.to} type="button" onClick={() => selectTab(t.to)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground">
                      <span className="w-6 text-center text-base">{t.icon}</span><span className="flex-1 text-left">{t.label}</span><kbd className="font-mono text-[10px] opacity-60">{t.key}</kbd>
                    </button>
                  ))}
                  <button type="button" onClick={lockManagement} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-secondary-foreground hover:bg-accent hover:text-foreground">
                    <span className="w-6 text-center text-base">🔒</span><span className="flex-1 text-left">Bloquear gerência</span>
                  </button>
                </>
              )}
            </nav>

            <div className="p-2 border-t border-border space-y-1">
              <div className="px-3 py-2 font-mono text-[11px] text-muted-foreground text-center">{time}</div>
              <button
                type="button"
                onClick={() => setDarkMode((value) => !value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm bg-secondary ring-1 ring-border text-secondary-foreground transition-colors hover:bg-accent"
                aria-label={darkMode ? "Ativar tema branco" : "Ativar tema escuro"}
              >
                {darkMode ? "☀️" : "🌙"}<span className="ml-2">{darkMode ? "Tema branco" : "Tema escuro"}</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  await supabase.auth.signOut();
                  localStorage.removeItem("mobflow-authenticated");
                  window.location.reload();
                }}
                className="w-full rounded-xl px-3 py-2.5 text-sm text-secondary-foreground hover:bg-accent hover:text-foreground transition-colors text-left"
              >
                ↪ Sair da conta
              </button>
              <button
                type="button"
                onClick={toggleSidebar}
                className="w-full rounded-xl px-3 py-2.5 text-sm text-secondary-foreground hover:bg-accent hover:text-foreground transition-colors text-left"
                aria-label="Fechar menu lateral"
              >
                ‹ Fechar menu
              </button>
            </div>
          </div>
        </aside>
      ) : (
        <button
          type="button"
          onClick={toggleSidebar}
          className="fixed left-0 top-1/2 z-50 -translate-y-1/2 h-10 w-5 rounded-r-lg bg-popover/95 ring-1 ring-border text-foreground shadow-sm flex items-center justify-center hover:bg-accent transition-colors"
          aria-label="Abrir menu lateral"
          title="Abrir menu"
        >
          ›
        </button>
      )}

      {managementPrompt && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-popover p-5 shadow-xl ring-1 ring-border">
            <h2 className="text-lg font-semibold text-heading">Acesso Gerência</h2>
            <p className="mt-1 text-sm text-muted-foreground">Digite a senha para liberar as opções de gerência.</p>
            <input autoFocus type="password" value={password} onChange={(e) => { setPassword(e.target.value); setPasswordError(""); }} onKeyDown={(e) => { if (e.key === "Enter") unlockManagement(); }} placeholder="Senha de gerência" className="mt-4 w-full rounded-xl border border-border bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
            {passwordError && <p className="mt-2 text-sm text-destructive">{passwordError}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setManagementPrompt(false)} className="flex-1 rounded-xl px-3 py-2.5 text-sm bg-secondary text-secondary-foreground hover:bg-accent">Cancelar</button>
              <button type="button" onClick={unlockManagement} className="flex-1 rounded-xl px-3 py-2.5 text-sm bg-primary text-primary-foreground hover:opacity-90">Entrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}