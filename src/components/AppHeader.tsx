import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

const tabs = [
  { to: "/", label: "PDV", key: "F2", icon: "▣" },
  { to: "/dashboard", label: "Dashboard", key: "F1", icon: "▥" },
  { to: "/estoque", label: "Estoque", key: "F3", icon: "□" },
  { to: "/vendas", label: "Vendas", key: "F4", icon: "↗" },
  { to: "/conferencia", label: "Conferência", key: "F7", icon: "✓" },
] as const;

export function AppHeader() {
  const navigate = useNavigate();
  const [time, setTime] = useState("");
  const [open, setOpen] = useState(() => localStorage.getItem("mobflow-sidebar") !== "closed");
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("mobflow-theme") === "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("mobflow-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const t = setInterval(tick, 15000);
    const onKey = (e: KeyboardEvent) => {
      const tab = tabs.find((t) => t.key === e.key);
      if (tab) { e.preventDefault(); navigate({ to: tab.to }); }
    };
    window.addEventListener("keydown", onKey);
    return () => { clearInterval(t); window.removeEventListener("keydown", onKey); };
  }, [navigate]);

  const toggleSidebar = () => setOpen((value) => {
    const next = !value;
    localStorage.setItem("mobflow-sidebar", next ? "open" : "closed");
    return next;
  });

  return (
    <>
      <aside className={"fixed left-0 top-0 z-50 h-screen transition-all duration-200 " + (open ? "w-64" : "w-16")}>
        <div className="h-full bg-popover/95 backdrop-blur-xl ring-r-1 ring-border flex flex-col">
          <div className={"h-20 flex items-center " + (open ? "px-4 gap-3" : "justify-center")}>
            <div className="h-9 w-9 shrink-0 rounded-xl bg-primary/15 ring-1 ring-primary/40 grid place-items-center font-display text-xl text-primary">M</div>
            {open && <div className="leading-none min-w-0"><div className="font-display tracking-[.18em] text-[20px] text-heading">MOBFLOW</div><div className="font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">PDV + ESTOQUE</div></div>}
          </div>
          <nav className="flex-1 px-2 space-y-1">
            {tabs.map((t) => <Link key={t.to} to={t.to} activeOptions={{ exact: true }} title={!open ? t.label + " (" + t.key + ")" : undefined} className={"flex items-center rounded-xl text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground " + (open ? "gap-3 px-3 py-3" : "justify-center px-2 py-3")} activeProps={{ className: "!bg-primary !text-primary-foreground !ring-1 !ring-primary" }}><span className="w-6 text-center text-base">{t.icon}</span>{open && <span className="flex-1">{t.label}</span>}{open && <kbd className="font-mono text-[10px] opacity-60">{t.key}</kbd>}</Link>)}
          </nav>
          <div className={"p-2 border-t border-border " + (open ? "space-y-1" : "")}>
            {open && <div className="px-3 py-2 font-mono text-[11px] text-muted-foreground text-center">{time}</div>}
            <button type="button" onClick={() => setDarkMode((value) => !value)} className={"w-full rounded-xl text-sm bg-secondary ring-1 ring-border text-secondary-foreground transition-colors hover:bg-accent " + (open ? "px-3 py-2.5" : "px-2 py-3")} aria-label={darkMode ? "Ativar tema branco" : "Ativar tema escuro"} title={darkMode ? "Tema branco" : "Tema escuro"}>{darkMode ? "☀️" : "🌙"}{open && <span className="ml-2">{darkMode ? "Tema branco" : "Tema escuro"}</span>}</button>
            <button type="button" onClick={toggleSidebar} className={"w-full rounded-xl text-sm text-secondary-foreground hover:bg-accent hover:text-foreground transition-colors " + (open ? "px-3 py-2.5 text-left" : "px-2 py-3")} aria-label={open ? "Fechar menu lateral" : "Abrir menu lateral"} title={open ? "Fechar menu" : "Abrir menu"}>{open ? "‹  Fechar menu" : "›"}</button>
          </div>
        </div>
      </aside>
      <div className={open ? "pl-64 transition-[padding] duration-200" : "pl-16 transition-[padding] duration-200"}>
        <header className="flex items-center justify-between gap-3 mb-4"><div className="h-9 w-9 rounded-xl bg-primary/15 ring-1 ring-primary/40 grid place-items-center font-display text-xl text-primary">M</div><span className="font-mono text-[11px] text-muted-foreground">{time}</span></header>
        <div className="h-[3px] rounded-full bg-primary/15 overflow-hidden mb-4"><div className="mfb-bar h-full w-full rounded-full bg-primary/70" /></div>
      </div>
    </>
  );
}