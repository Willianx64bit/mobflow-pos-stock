import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

const tabs = [
  { to: "/", label: "PDV", key: "F2" },
  { to: "/dashboard", label: "Dashboard", key: "F1" },
  { to: "/estoque", label: "Estoque", key: "F3" },
  { to: "/vendas", label: "Vendas", key: "F4" },
  { to: "/conferencia", label: "Conferência", key: "F7" },
] as const;

export function AppHeader() {
  const navigate = useNavigate();
  const [time, setTime] = useState("");
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

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/15 ring-1 ring-primary/40 grid place-items-center font-display text-xl text-primary">M</div>
          <div className="leading-none">
            <div className="font-display tracking-[.18em] text-[22px] text-heading">MOBFLOW</div>
            <div className="font-mono text-[9px] uppercase tracking-[.2em] text-muted-foreground">PDV + ESTOQUE</div>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-2">
          {tabs.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              activeOptions={{ exact: true }}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-secondary ring-1 ring-border text-secondary-foreground transition-colors"
              activeProps={{ className: "!bg-primary !text-primary-foreground !ring-primary font-semibold" }}
            >
              {t.label} <kbd className="font-mono text-[10px] opacity-60">{t.key}</kbd>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setDarkMode((value) => !value)}
            className="ml-1 px-3 py-2 rounded-xl text-sm bg-secondary ring-1 ring-border text-secondary-foreground transition-colors hover:bg-accent"
            aria-label={darkMode ? "Ativar tema branco" : "Ativar tema escuro"}
            title={darkMode ? "Tema branco" : "Tema escuro"}
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
          <span className="ml-1 font-mono text-[11px] text-muted-foreground">{time}</span>
        </nav>
      </header>
      <div className="h-[3px] rounded-full bg-primary/15 overflow-hidden mb-4">
        <div className="mfb-bar h-full w-full rounded-full bg-primary/70" />
      </div>
    </>
  );
}
