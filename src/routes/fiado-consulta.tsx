import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { ArrowLeft, CreditCard, Filter, Search } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { brl, useStore, type Sale } from "@/lib/store";

export const Route = createFileRoute("/fiado-consulta")({
  head: () => ({ meta: [{ title: "MobFlow — Consulta de fiado" }] }),
  component: FiadoConsulta,
});

function FiadoConsulta() {
  const sales = useStore((s) => s.sales);
  const navigate = useNavigate();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const today = new Date();
  const todayKey = today.getFullYear() + "-" + String(today.getMonth()+1).padStart(2,"0") + "-" + String(today.getDate()).padStart(2,"0");
  const [mode, setMode] = useState<"month" | "range">("month");
  const [month, setMonth] = useState(todayKey.slice(0,7));
  const [startDate, setStartDate] = useState(todayKey);
  const [endDate, setEndDate] = useState(todayKey);
  const [expanded, setExpanded] = useState<string[]>([]);
  const paidTotal = (s: Sale) => (s.payments ?? (s.paid ? [{ value: s.total, date: s.paidAt ?? s.date }] : [])).reduce((sum,p) => sum+p.value,0);
  const remaining = (s: Sale) => Math.max(0, Math.round((s.total-paidTotal(s))*100)/100);

  useEffect(() => {
    const permissions = (() => { try { return JSON.parse(sessionStorage.getItem("mobflow-permissions") || "[]") as string[]; } catch { return []; } })();
    if (sessionStorage.getItem("mobflow-management") !== "1") navigate({ to: "/gerencia" });
  }, [navigate]);

  const customers = useMemo(() => {
    const map = new Map<string, Sale[]>();
    sales.filter(s => s.payment === "Fiado" && !s.hiddenFromFiado).forEach(s => {
      const key = (s.customer || "Cliente não informado").trim();
      const date = new Date(s.date);
      const day = date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0");
      const inPeriod = mode === "month" ? day.slice(0,7) === month : startDate <= endDate && day >= startDate && day <= endDate;
      if (inPeriod) map.set(key, [...(map.get(key) || []), s]);
    });
    return [...map.entries()].map(([name, rows]) => ({ name, rows: rows.sort((a,b) => +new Date(b.date)-+new Date(a.date)), total: rows.reduce((n,s)=>n+s.total,0), paid: rows.reduce((n,s)=>n+paidTotal(s),0), due: rows.reduce((n,s)=>n+remaining(s),0) })).filter(c => c.name.toLocaleLowerCase("pt-BR").includes(customerSearch.trim().toLocaleLowerCase("pt-BR"))).sort((a,b)=>a.name.localeCompare(b.name));
  }, [sales, mode, month, startDate, endDate, customerSearch]);

  const totalDue = customers.reduce((sum,c)=>sum+c.due,0);
  return <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader /><main className="mx-auto max-w-6xl space-y-4">
    <section className="glass p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><CreditCard className="h-5 w-5"/></div><div><h1 className="font-display text-2xl text-heading">Consulta de fiado</h1><p className="text-sm text-muted-foreground">Somente visualização. Nenhum pagamento ou cadastro pode ser alterado aqui.</p></div></div>
        <div className="flex flex-wrap gap-2"><button onClick={()=>navigate({to:"/vendas"})} className="rounded-lg bg-secondary px-3 py-2 text-sm font-semibold"><ArrowLeft className="mr-1 inline h-4 w-4"/>Voltar</button><button onClick={()=>setFiltersOpen(v=>!v)} className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-semibold"><Filter className="h-4 w-4"/>{filtersOpen?"Fechar filtros":"Filtrar"}</button></div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-border bg-background/70 p-4"><div className="text-sm text-muted-foreground">Clientes no período</div><div className="mt-1 font-display text-2xl">{customers.length}</div></div><div className="rounded-xl border border-border bg-background/70 p-4"><div className="text-sm text-muted-foreground">Saldo pendente</div><div className="mt-1 font-display text-2xl text-orange-600">R$ {brl(totalDue)}</div></div><div className="rounded-xl border border-border bg-background/70 p-4"><div className="text-sm text-muted-foreground">Compras no período</div><div className="mt-1 font-display text-2xl">{customers.reduce((n,c)=>n+c.rows.length,0)}</div></div></div>
      {filtersOpen && <div className="mt-4 grid gap-3 rounded-xl border border-border bg-secondary/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm text-muted-foreground sm:col-span-2">Buscar cliente<div className="relative mt-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"/><input value={customerSearch} onChange={e=>setCustomerSearch(e.target.value)} placeholder="Digite o nome do cliente" className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-foreground"/></div></label>
        <label className="text-sm text-muted-foreground">Período<select value={mode} onChange={e=>setMode(e.target.value as "month"|"range")} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"><option value="month">Por mês</option><option value="range">Data personalizada</option></select></label>
        {mode==="month" ? <label className="text-sm text-muted-foreground">Mês<input type="month" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"/></label> : <><label className="text-sm text-muted-foreground">Data inicial<input type="date" value={startDate} max={endDate} onChange={e=>e.target.value&&setStartDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"/></label><label className="text-sm text-muted-foreground">Data final<input type="date" value={endDate} min={startDate} onChange={e=>e.target.value&&setEndDate(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"/></label></>}
        <div className="flex items-end"><button onClick={()=>{setCustomerSearch("");setMode("month");setMonth(todayKey.slice(0,7));setStartDate(todayKey);setEndDate(todayKey);}} className="rounded-lg px-3 py-2 font-semibold text-primary">Limpar filtros</button></div>
      </div>}
    </section>
    <section className="glass p-4"><p className="mb-3 text-sm text-muted-foreground">Agrupado por cliente · {mode==="month" ? new Date(month+"-01T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"}) : startDate.split("-").reverse().join("/")+" a "+endDate.split("-").reverse().join("/")}</p>
      {customers.length===0 ? <p className="py-10 text-center text-muted-foreground">Nenhum fiado encontrado neste período.</p> : <div className="space-y-3">{customers.map(c=>{const open=expanded.includes(c.name);return <article key={c.name} className="rounded-xl border border-border bg-background/50 p-4">
        <button onClick={()=>setExpanded(old=>open?old.filter(x=>x!==c.name):[...old,c.name])} className="flex w-full flex-wrap items-center gap-3 text-left"><div className="min-w-0 flex-1"><div className="font-semibold text-heading">{c.name}</div><div className="text-xs text-muted-foreground">{c.rows.length} compra(s) · {c.rows.filter(s=>remaining(s)>0).length} pendente(s)</div></div><div className="text-right"><div className="text-sm text-green-600">Pago: R$ {brl(c.paid)}</div><div className="font-display text-xl text-orange-600">Falta pagar: R$ {brl(c.due)}</div></div><span className={c.due>0?"rounded-full bg-orange-500/15 px-3 py-1 text-xs font-bold text-orange-600":"rounded-full bg-green-500/15 px-3 py-1 text-xs font-bold text-green-600"}>{c.due>0?"Pendente":"Pago"}</span></button>
        {open && <div className="mt-3 space-y-2 border-t border-border pt-3">{c.rows.map(s=><div key={s.id} className="rounded-lg bg-secondary/40 p-3"><div className="flex flex-wrap justify-between gap-2"><div><div className="font-semibold">{new Date(s.date).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</div><div className="text-xs text-muted-foreground">Comprovante: {s.id}</div></div><div className="text-right"><div>Total: R$ {brl(s.total)}</div><div className="text-green-600">Pago: R$ {brl(paidTotal(s))}</div><div className="font-semibold text-orange-600">Falta: R$ {brl(remaining(s))}</div></div></div><div className="mt-3 overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[520px] text-left text-sm"><thead className="bg-secondary/70 text-muted-foreground"><tr><th className="px-3 py-2">Data/hora</th><th className="px-3 py-2">Produtos</th><th className="px-3 py-2 text-right">Quantidade</th><th className="px-3 py-2 text-right">Valor</th></tr></thead><tbody>{s.items.map((item,index)=><tr key={item.productId||item.name+index} className="border-t border-border"><td className="whitespace-nowrap px-3 py-2">{new Date(s.date).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</td><td className="px-3 py-2">{item.name}</td><td className="whitespace-nowrap px-3 py-2 text-right">{item.qty} {item.unit==="kg"?"kg":"un"}</td><td className="whitespace-nowrap px-3 py-2 text-right">R$ {brl(item.price*item.qty)}</td></tr>)}</tbody><tfoot className="border-t border-border bg-secondary/40"><tr><td colSpan={3} className="px-3 py-2 text-right font-semibold">Total da compra</td><td className="whitespace-nowrap px-3 py-2 text-right font-bold">R$ {brl(s.total)}</td></tr></tfoot></table></div>{(s.payments??[]).length>0&&<div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">Pagamentos: {(s.payments??[]).map(p=>new Date(p.date).toLocaleDateString("pt-BR")+" — R$ "+brl(p.value)).join(" · ")}</div>}</div>)}</div>}
      </article>})}</div>}
    </section>
  </main></div>;
}
