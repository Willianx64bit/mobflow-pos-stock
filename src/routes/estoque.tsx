import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ProductForm } from "@/components/ProductForm";
import { actions, brl, norm, useStore, type Product } from "@/lib/store";

export const Route = createFileRoute("/estoque")({
  head: () => ({
    meta: [
      { title: "MobFlow — Estoque" },
      { name: "description", content: "Adicione e edite produtos, preços e quantidades do estoque em segundos." },
      { property: "og:title", content: "MobFlow — Estoque" },
      { property: "og:description", content: "Controle de estoque rápido com edição direta na tabela." },
    ],
  }),
  component: Estoque,
});

function Cell({ value, onSave, money, danger, weight }: { value: number; onSave: (n: number) => void; money?: boolean; danger?: boolean; weight?: boolean }) {
  const fmt = money ? brl(value) : weight ? `${brl(value)}kg` : String(value);
  const [v, setV] = useState(fmt);
  useEffect(() => setV(fmt), [fmt]);
  const commit = () => {
    const raw = weight ? v.trim().toLowerCase().replace(",", ".") : v;
    const n = weight
      ? (/^\d+(?:\.\d+)?\s*g$/.test(raw) ? Number(raw.replace(/g$/, "").trim()) / 1000 : /^\d+(?:\.\d+)?\s*kg$/.test(raw) ? Number(raw.replace(/kg$/, "").trim()) : NaN)
      : Number(raw.replace(/\./g, money ? "" : ".").replace(",", "."));
    if (!Number.isNaN(n) && n !== value) onSave(money ? n : weight ? n : Math.round(n)); else setV(fmt);
  };
  return (
    <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      onFocus={(e) => e.target.select()} inputMode="decimal"
      className={`w-full bg-transparent font-mono rounded-md px-2 py-1 outline-none hover:bg-secondary focus:bg-well focus:ring-1 focus:ring-ring ${danger ? "text-destructive" : money ? "text-subtle" : "text-foreground"}`} />
  );
}

function Estoque() {
  const products = useStore((s) => s.products);
  const [q, setQ] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "F7" || (e.key === "n" && e.altKey)) { e.preventDefault(); setEditing(null); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const list = useMemo(() => {
    const n = norm(q);
    return products.filter((p) => (!onlyLow || p.stock <= p.minStock) && (!n || norm(p.name).includes(n) || p.code.includes(n) || norm(p.category).includes(n)));
  }, [products, q, onlyLow]);
  const lowCount = products.filter((p) => p.stock <= p.minStock).length;
  const value = products.reduce((s, p) => s + p.price * Math.max(0, p.stock), 0);

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        {[["Produtos", String(products.length)], ["Valor em estoque", `R$ ${brl(value)}`], ["Estoque baixo", String(lowCount)]].map(([l, v], i) => (
          <div key={l} className="glass p-4">
            <div className="label-mono">{l}</div>
            <div className={`font-display text-4xl mt-1 ${i === 2 && lowCount ? "text-destructive" : "text-heading"}`}>{v}</div>
          </div>
        ))}
      </div>
      <section className="glass p-4">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por nome, código ou categoria…" className="field flex-1 min-w-60 text-sm text-foreground" />
          <button onClick={() => setOnlyLow(!onlyLow)}
            className={`rounded-lg px-3 py-2 text-[12px] font-semibold ring-1 ${onlyLow ? "bg-destructive/15 ring-destructive/50 text-destructive" : "bg-secondary ring-border text-secondary-foreground"}`}>
            ⚠ Só estoque baixo
          </button>
          <button onClick={() => setEditing(null)} className="text-[13px] font-semibold text-primary-foreground bg-primary rounded-lg px-4 py-2 hover:bg-primary/85">
            + Produto <kbd className="font-mono text-[10px] opacity-70">F7</kbd>
          </button>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[808px]">
            <div className="grid grid-cols-[48px_130px_1fr_120px_110px_90px_110px_70px] gap-x-3 label-mono px-2 pb-2">
              <span>Foto</span><span>Código</span><span>Produto</span><span>Categoria</span><span>Preço R$</span><span>Estoque</span><span>Situação</span><span />
            </div>
            <div className="divide-y divide-border/50">
              {list.map((p) => {
                const low = p.stock <= p.minStock;
                return (
                  <div key={p.id} className={`grid grid-cols-[48px_130px_1fr_120px_110px_90px_110px_70px] gap-x-3 items-center py-1.5 px-2 text-[13px] rounded-lg ${low ? "bg-destructive/5" : ""}`}>
                    <div className="h-9 w-9 overflow-hidden rounded-md bg-surface ring-1 ring-border/50 grid place-items-center">{p.photo ? <img src={p.photo} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] text-muted-foreground">—</span>}</div>\n                    <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
                    <span className="text-foreground truncate">{p.name}</span>
                    <span className="text-muted-foreground text-[12px]">{p.category}</span>
                    <Cell money value={p.price} onSave={(n) => actions.updateField(p.id, "price", n)} />
                    <div className="flex items-center gap-1">
                      <Cell value={p.stock} weight={p.unit === "kg"} danger={low} onSave={(n) => actions.updateField(p.id, "stock", n)} />
                      <button onClick={() => actions.updateField(p.id, "stock", p.stock + 1)} className="h-6 w-6 shrink-0 rounded-md text-subtle hover:bg-accent">+</button>
                    </div>
                    <span className={`font-mono text-[11px] ${low ? "text-destructive" : "text-muted-foreground"}`}>{p.stock <= 0 ? "⚠ esgotado" : low ? "⚠ baixo" : "normal"}</span>
                    <button onClick={() => setEditing(p)} className="font-mono text-[11px] uppercase tracking-[.15em] text-muted-foreground hover:text-primary">Editar</button>
                  </div>
                );
              })}
              {list.length === 0 && <p className="py-10 text-center font-mono text-[11px] text-muted-foreground">nenhum produto encontrado</p>}
            </div>
          </div>
        </div>
        <p className="mt-3 font-mono text-[10px] text-muted-foreground">Clique no preço ou estoque para editar · produtos por peso aceitam kg ou g · ↵ salva</p>
      </section>
      {editing !== undefined && <ProductForm product={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
