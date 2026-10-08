import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { brl, hydrateStore, useStore } from "@/lib/store";
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
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [from] = useState(firstDayOfMonth);
  const [to] = useState(isoToday);

  useEffect(() => {
    setUnlocked(sessionStorage.getItem("mobflow-management") === "1");
  }, []);

  const handleManagerLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (password !== "gerencia123") {
      setError("Senha da gerência incorreta.");
      setPassword("");
      setLoading(false);
      return;
    }

    sessionStorage.setItem("mobflow-management", "1");
    setUnlocked(true);
    setPassword("");
    setLoading(false);
  };

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
              <div className="w-full rounded-2xl bg-surface ring-1 ring-border p-6 sm:p-8">
                <div className="text-center">
                  <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/15 ring-1 ring-primary/40 grid place-items-center font-display text-3xl text-primary">M</div>
                  <div className="mt-4 font-display tracking-[.18em] text-3xl text-heading">MOBFLOW</div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">GERÊNCIA</div>
                </div>
                <form onSubmit={handleManagerLogin} className="mt-7 space-y-4">
                  <input value={password} onChange={(e) => setPassword(e.target.value)} autoFocus type="password" placeholder="Senha da gerência" className="field w-full text-foreground" />
                  {error && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{error}</div>}
                  <button type="submit" disabled={loading} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground disabled:opacity-50">
                    {loading ? "Validando..." : "Entrar na gerência"}
                  </button>
                </form>

