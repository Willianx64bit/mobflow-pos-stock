import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { hydrateStore } from "@/lib/store";
import { LoginScreen } from "@/components/LoginScreen";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const tabs = [
  { to: "/", label: "PDV", key: "F2", icon: "▣" },
  { to: "/conferencia", label: "Conferência", key: "F7", icon: "✓" },
  { to: "/fiado", label: "Fiado", key: "", icon: "💳" },
  { to: "/gerencia", label: "Acesso Gerência", key: "", icon: "🔒" },
] as const;

export function AppHeader() {
  const navigate = useNavigate();
  const [time, setTime] = useState("");
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [pdvAuthorized, setPdvAuthorized] = useState(false);
  const [username, setUsername] = useState("Usuário");
  const settings = useStore((s) => s.settings);

  useEffect(() => {
    setOpen(() => {
      const saved = localStorage.getItem("mobflow-sidebar");
      if (saved === "open") return true;
      if (saved === "closed") return false;
      return window.innerWidth >= 768;
    });
    setDarkMode(localStorage.getItem("mobflow-theme") === "dark");
    setPdvAuthorized(sessionStorage.getItem("mobflow-pdv-authorized") === "1");
    setUsername(sessionStorage.getItem("mobflow-username") || "Usuário");
    setMounted(true);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("mfb-side-open", open);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("mobflow-theme", darkMode ? "dark" : "light");
  }, [darkMode, mounted]);

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const onKey = (e: KeyboardEvent) => {
      const tab = tabs.find((item) => item.key && item.key === e.key);
      if (!tab) return;
      e.preventDefault();
      navigate({ to: tab.to });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [navigate]);

  useEffect(() => {
    const sync = () => {
      setPdvAuthorized(sessionStorage.getItem("mobflow-pdv-authorized") === "1");
      setUsername(sessionStorage.getItem("mobflow-username") || "Usuário");
    };
    window.addEventListener("mobflow-pdv-auth-changed", sync);
    return () => window.removeEventListener("mobflow-pdv-auth-changed", sync);
  }, []);

  const selectTab = (to: (typeof tabs)[number]["to"]) => {
    localStorage.setItem("mobflow-sidebar", "closed");
    setOpen(false);
    navigate({ to });
  };

  const toggleSidebar = () => setOpen((value) => {
    const next = !value;
    localStorage.setItem("mobflow-sidebar", next ? "open" : "closed");
    return next;
  });

  const logoutPdv = () => {
    sessionStorage.removeItem("mobflow-pdv-authorized");
    sessionStorage.removeItem("mobflow-role");
    sessionStorage.removeItem("mobflow-username");
    localStorage.removeItem("mobflow-authenticated");
    setPdvAuthorized(false);
    setUsername("Usuário");
    setShowLogoutConfirm(false);
    window.dispatchEvent(new Event("mobflow-pdv-auth-changed"));
    navigate({ to: "/" });
  };

  if (!mounted) return null;

  return createPortal(
    <>
      {pathname === "/" && (
        <div className="fixed right-4 top-4 z-[90] flex items-center gap-2">
          <button type="button" onClick={() => setShowLogin(true)} className="rounded-xl bg-popover/95 px-4 py-2.5 text-sm font-semibold text-foreground shadow-lg ring-1 ring-border backdrop-blur-xl hover:bg-accent">
            👤 {pdvAuthorized ? username : "Usuário"}
          </button>
          {pdvAuthorized && (
            <button type="button" onClick={() => setShowLogoutConfirm(true)} className="grid h-11 w-11 place-items-center rounded-xl bg-red-500 text-white shadow-lg ring-1 ring-red-600/50 transition-colors hover:bg-red-600" aria-label="Sair do usuário do PDV" title="Sair">
              ⏻
            </button>
          )}
        </div>
      )}

      {showLogin && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md">
            <LoginScreen mode="pdv" onLogin={async () => {
              await hydrateStore();
              setPdvAuthorized(true);
              setUsername(sessionStorage.getItem("mobflow-username") || "Usuário");
              window.dispatchEvent(new Event("mobflow-pdv-auth-changed"));
              setShowLogin(false);
              localStorage.setItem("mobflow-sidebar", "closed");
              setOpen(false);
              navigate({ to: "/" });
            }} />
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/45 p-4 backdrop-blur-sm" onClick={() => setShowLogoutConfirm(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-popover p-6 text-center shadow-2xl ring-1 ring-border" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-500/15 text-2xl text-red-600 ring-1 ring-red-500/30">⏻</div>
            <h2 className="mt-3 font-display text-2xl tracking-[.08em] text-heading">SAIR DO PDV?</h2>
            <p className="mt-2 text-sm text-muted-foreground">O usuário será desconectado das vendas. O PDV continuará disponível apenas para pesquisa.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setShowLogoutConfirm(false)} className="rounded-xl bg-secondary py-3 font-semibold text-secondary-foreground ring-1 ring-border hover:bg-accent">Cancelar</button>
              <button type="button" onClick={logoutPdv} className="rounded-xl bg-red-600 py-3 font-bold text-white hover:bg-red-700">Sair</button>
            </div>
          </div>
        </div>
      )}

      {open ? (
        <aside className="fixed left-0 top-0 z-50 h-screen w-64 transition-transform duration-200">
          <div className="h-full bg-popover/95 backdrop-blur-xl ring-r-1 ring-border flex flex-col">
            <div className="h-20 flex items-center px-4 gap-3">
              {settings.companyLogo ? <img src={settings.companyLogo} alt="" className="h-10 w-10 shrink-0 rounded-xl object-contain bg-background ring-1 ring-border" /> : <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/15 ring-1 ring-primary/40 grid place-items-center font-display text-xl text-primary">M</div>}
              <div className="leading-none min-w-0"><div className="font-display tracking-[.12em] text-[18px] text-heading truncate">{settings.companyName || "MOBFLOW"}</div></div>
            </div>
            <nav className="flex-1 px-2 space-y-1">
              {tabs.map((t) => <button key={t.to} type="button" onClick={() => selectTab(t.to)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground"><span className="w-6 text-center text-base">{t.icon}</span><span className="flex-1 text-left">{t.label}</span>{t.key && <kbd className="font-mono text-[10px] opacity-60">{t.key}</kbd>}</button>)}
            </nav>
            <div className="p-2 border-t border-border space-y-1">
              <div className="px-3 py-2 font-mono text-[11px] text-muted-foreground text-center">{time}</div>
              <button type="button" onClick={() => setDarkMode((value) => !value)} className="w-full rounded-xl px-3 py-2.5 text-sm bg-secondary ring-1 ring-border text-secondary-foreground transition-colors hover:bg-accent">{darkMode ? "☀️" : "🌙"}<span className="ml-2">{darkMode ? "Tema branco" : "Tema escuro"}</span></button>
              <button type="button" onClick={async () => { await supabase.auth.signOut(); localStorage.removeItem("mobflow-authenticated"); sessionStorage.removeItem("mobflow-role"); sessionStorage.removeItem("mobflow-username"); sessionStorage.removeItem("mobflow-pdv-authorized"); setPdvAuthorized(false); window.dispatchEvent(new Event("mobflow-pdv-auth-changed")); navigate({ to: "/" }); }} className="w-full rounded-xl px-3 py-2.5 text-sm text-secondary-foreground hover:bg-accent hover:text-foreground transition-colors text-left">↪ Sair da conta</button>
              <button type="button" onClick={toggleSidebar} className="w-full rounded-xl px-3 py-2.5 text-sm text-secondary-foreground hover:bg-accent hover:text-foreground transition-colors text-left">‹ Fechar menu</button>
            </div>
          </div>
        </aside>
      ) : (
        <button type="button" onClick={toggleSidebar} className="fixed left-0 top-1/2 z-50 -translate-y-1/2 h-10 w-5 rounded-r-lg bg-popover/95 ring-1 ring-border text-foreground shadow-sm flex items-center justify-center hover:bg-accent transition-colors" aria-label="Abrir menu lateral" title="Abrir menu">›</button>
      )}
    </>,
    document.body,
  );
}
