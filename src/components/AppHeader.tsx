import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { hydrateStore } from "@/lib/store";
import { LoginScreen } from "@/components/LoginScreen";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ShoppingCart, ClipboardCheck, CalendarDays, CreditCard, LockKeyhole, UserRound, LogOut, Sun, Moon, ChevronLeft, ChevronRight } from "lucide-react";

const tabs = [
  { to: "/", label: "PDV", key: "F2", icon: "pdv" },
  { to: "/operacoes", label: "Operações", key: "F7", icon: "operations" },
  { to: "/validade", label: "Validade dos produtos", key: "", icon: "expiry" },
  { to: "/fiado", label: "Fiado", key: "", icon: "credit" },
  { to: "/gerencia", label: "Acesso Gerência", key: "", icon: "management" },
] as const;

export function AppHeader() {
  const navigate = useNavigate();
  const [time, setTime] = useState("");
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [pdvAuthorized, setPdvAuthorized] = useState(false);
  const [username, setUsername] = useState("Usuário");
  const [permissions, setPermissions] = useState<string[]>(["PDV"]);
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
    try { const saved = JSON.parse(sessionStorage.getItem("mobflow-permissions") || '["PDV"]') as string[]; setPermissions(Array.from(new Set(saved.map((p) => p === "Conferência" ? "Operações" : p)))); } catch { setPermissions(["PDV"]); }
    setMounted(true);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("mfb-side-open", open);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideTap = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && sidebarRef.current && !sidebarRef.current.contains(target)) {
        localStorage.setItem("mobflow-sidebar", "closed");
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideTap);
    return () => document.removeEventListener("pointerdown", closeOnOutsideTap);
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
      const required: Record<string, string> = { "/": "PDV", "/operacoes": "Operações", "/validade": "Validade", "/fiado": "Fiado", "/gerencia": "Gerência" };
      if (permissions.includes("Operações") && !permissions.includes("PDV") && tab.to !== "/operacoes") { window.alert("Este usuário tem acesso somente a Operações."); return; }
      if (!permissions.includes(required[tab.to] ?? "")) {
        window.alert("Seu usuário não tem permissão para acessar esta área.");
        return;
      }
      navigate({ to: tab.to });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [navigate, permissions]);

  useEffect(() => {
    const sync = () => {
      setPdvAuthorized(sessionStorage.getItem("mobflow-pdv-authorized") === "1");
      setUsername(sessionStorage.getItem("mobflow-username") || "Usuário");
    try { const saved = JSON.parse(sessionStorage.getItem("mobflow-permissions") || '["PDV"]') as string[]; setPermissions(Array.from(new Set(saved.map((p) => p === "Conferência" ? "Operações" : p)))); } catch { setPermissions(["PDV"]); }
    };
    window.addEventListener("mobflow-pdv-auth-changed", sync);
    return () => window.removeEventListener("mobflow-pdv-auth-changed", sync);
  }, []);

  const selectTab = (to: (typeof tabs)[number]["to"]) => {
    const required: Record<string, string> = { "/": "PDV", "/operacoes": "Operações", "/validade": "Validade", "/fiado": "Fiado", "/gerencia": "Gerência" };
    if (permissions.includes("Operações") && !permissions.includes("PDV") && to !== "/operacoes") { window.alert("Este usuário tem acesso somente a Operações."); return; }
    if (!permissions.includes(required[to] ?? "")) { window.alert("Seu usuário não tem permissão para acessar esta área."); return; }
    localStorage.setItem("mobflow-sidebar", "closed");
    setOpen(false);
    navigate({ to });
  };

  const toggleSidebar = () => setOpen((value) => {
    const next = !value;
    localStorage.setItem("mobflow-sidebar", next ? "open" : "closed");
    return next;
  });

  const logoutPdv = async () => {
    sessionStorage.removeItem("mobflow-pdv-authorized");
    sessionStorage.removeItem("mobflow-role");
    sessionStorage.removeItem("mobflow-username");
    sessionStorage.removeItem("mobflow-permissions");
    localStorage.removeItem("mobflow-authenticated");
    await supabase.auth.signOut();
    setPdvAuthorized(false);
    setUsername("Usuário");
    setShowLogoutConfirm(false);
    window.dispatchEvent(new Event("mobflow-pdv-auth-changed"));
    window.dispatchEvent(new Event("mobflow-user-logout"));
  };

  if (!mounted) return null;

  return createPortal(
    <>
      {(pathname === "/" || pathname === "/operacoes") && (
        <div className="fixed right-4 top-4 z-[90] flex items-center gap-2">
          <button type="button" onClick={() => { if (pathname === "/") setShowLogin(true); }} className="rounded-xl bg-popover/95 px-4 py-2.5 text-sm font-semibold text-foreground shadow-lg ring-1 ring-border backdrop-blur-xl hover:bg-accent">
            <UserRound className="mr-2 inline h-4 w-4 text-green-600" />{pdvAuthorized ? username : "Usuário"}
          </button>
          {pdvAuthorized && (
            <button type="button" onClick={() => setShowLogoutConfirm(true)} className="grid h-11 w-11 place-items-center rounded-xl bg-red-500 text-white shadow-lg ring-1 ring-red-600/50 transition-colors hover:bg-red-600" aria-label="Sair da conta do usuário" title="Sair da conta">
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {showLogin && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md">
            <LoginScreen mode="pdv" onClose={() => setShowLogin(false)} onLogin={async () => {
              await hydrateStore();
              setPdvAuthorized(true);
              setUsername(sessionStorage.getItem("mobflow-username") || "Usuário");
              window.dispatchEvent(new Event("mobflow-pdv-auth-changed"));
              setShowLogin(false);
              localStorage.setItem("mobflow-sidebar", "closed");
              setOpen(false);
              const userPermissions = (() => {
                try {
                  const saved = JSON.parse(sessionStorage.getItem("mobflow-permissions") || "[]") as string[];
                  const normalized = Array.from(new Set(saved.map((p) => p === "Conferência" ? "Operações" : p)));
                  sessionStorage.setItem("mobflow-permissions", JSON.stringify(normalized));
                  return normalized;
                } catch { return []; }
              })();
              if (!userPermissions.includes("PDV") && userPermissions.includes("Operações")) {
                navigate({ to: "/operacoes" });
              } else {
                navigate({ to: "/" });
              }
            }} />
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/45 p-4 backdrop-blur-sm" onClick={() => setShowLogoutConfirm(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-popover p-6 text-center shadow-2xl ring-1 ring-border" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-500/15 text-2xl text-red-600 ring-1 ring-red-500/30"><LogOut className="h-6 w-6" /></div>
            <h2 className="mt-3 font-display text-2xl tracking-[.08em] text-heading">SAIR DA CONTA?</h2>
            <p className="mt-2 text-sm text-muted-foreground">Você será desconectado deste usuário e precisará entrar novamente para continuar.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setShowLogoutConfirm(false)} className="rounded-xl bg-secondary py-3 font-semibold text-secondary-foreground ring-1 ring-border hover:bg-accent">Cancelar</button>
              <button type="button" onClick={logoutPdv} className="rounded-xl bg-red-600 py-3 font-bold text-white hover:bg-red-700">Sair da conta</button>
            </div>
          </div>
        </div>
      )}

      <aside ref={sidebarRef} aria-hidden={!open} className={`fixed left-0 top-0 z-50 h-screen w-64 transform transition-transform duration-200 ease-out motion-reduce:transition-none ${open ? "translate-x-0 pointer-events-auto" : "-translate-x-full pointer-events-none"}`}>
          <div className="h-full bg-popover/95 backdrop-blur-xl ring-r-1 ring-border flex flex-col">
            <div className="h-20 flex items-center px-4 gap-3">
              {settings.companyLogo ? <img src={settings.companyLogo} alt="" className="h-10 w-10 shrink-0 rounded-xl object-contain bg-background ring-1 ring-border" /> : <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/15 ring-1 ring-primary/40 grid place-items-center font-display text-xl text-primary">M</div>}
              <div className="leading-none min-w-0"><div className="font-display tracking-[.12em] text-[18px] text-heading truncate">{settings.companyName || "MOBFLOW"}</div></div>
            </div>
            <nav className="flex-1 px-2 space-y-1">
              {tabs.filter((t) => permissions.includes(({ "/": "PDV", "/operacoes": "Operações", "/validade": "Validade", "/fiado": "Fiado", "/gerencia": "Gerência" } as Record<string, string>)[t.to]) && !(permissions.includes("Operações") && t.to === "/gerencia")).map((t) => <button key={t.to} type="button" onClick={() => selectTab(t.to)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground"><span className="flex w-6 shrink-0 justify-center text-green-600">{t.icon === "pdv" ? <ShoppingCart className="h-5 w-5" /> : t.icon === "operations" ? <ClipboardCheck className="h-5 w-5" /> : t.icon === "expiry" ? <CalendarDays className="h-5 w-5" /> : t.icon === "credit" ? <CreditCard className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}</span><span className="flex-1 text-left">{t.label}</span>{t.key && <kbd className="font-mono text-[10px] opacity-60">{t.key}</kbd>}</button>)}
            </nav>
            <div className="p-2 border-t border-border space-y-1">
              <div className="px-3 py-2 font-mono text-[11px] text-muted-foreground text-center">{time}</div>
              <button type="button" onClick={() => setDarkMode((value) => !value)} className="w-full rounded-xl px-3 py-2.5 text-sm bg-secondary ring-1 ring-border text-secondary-foreground transition-colors hover:bg-accent">{darkMode ? <Sun className="inline h-4 w-4 text-green-600" /> : <Moon className="inline h-4 w-4 text-green-600" />}<span className="ml-2">{darkMode ? "Tema branco" : "Tema escuro"}</span></button>
              <button type="button" onClick={toggleSidebar} className="w-full rounded-xl px-3 py-2.5 text-sm text-secondary-foreground hover:bg-accent hover:text-foreground transition-colors text-left"><ChevronLeft className="mr-2 inline h-4 w-4 text-green-600" />Fechar menu</button>
            </div>
          </div>
        </aside>
      {!open && (
        <button type="button" onClick={toggleSidebar} className="fixed left-0 top-1/2 z-50 -translate-y-1/2 h-10 w-5 rounded-r-lg bg-popover/95 ring-1 ring-border text-foreground shadow-sm flex items-center justify-center hover:bg-accent transition-colors" aria-label="Abrir menu lateral" title="Abrir menu"><ChevronRight className="h-4 w-4 text-green-600" /></button>
      )}
    </>,
    document.body,
  );
}
