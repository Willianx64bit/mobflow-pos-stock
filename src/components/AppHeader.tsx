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
  }, [navigate]);

  const toggleSidebar = () => setOpen((value) => {
    const next = !value;
    localStorage.setItem("mobflow-sidebar", next ? "open" : "closed");
    return next;
  });

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
              {tabs.map((t) => (
                <Link
                  key={t.to}
                  to={t.to}
                  activeOptions={{ exact: true }}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground"
                  activeProps={{ className: "!bg-primary !text-primary-foreground !ring-1 !ring-primary" }}
                >
                  <span className="w-6 text-center text-base">{t.icon}</span>
                  <span className="flex-1">{t.label}</span>
                  <kbd className="font-mono text-[10px] opacity-60">{t.key}</kbd>
                </Link>
              ))}
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
    </>
  );
}