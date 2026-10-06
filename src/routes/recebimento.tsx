import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, brl, useStore } from "@/lib/store";

export const Route = createFileRoute("/recebimento")({
  head: () => ({ meta: [{ title: "MobFlow — Recebimento" }, { name: "description", content: "Cadastro e aprovação de notas recebidas." }] }),
  component: Recebimento,
});

function Recebimento() {
  const products = useStore((s) => s.products);
  const notes = useStore((s) => s.receiving ?? []);
  const navigate = useNavigate();
  const [number, setNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [items, setItems] = useState<{ productId: string; expected: number }[]>([]);

  const addItem = () => {
    const n = Number(qty.replace(",", "."));
    if (!productId || !Number.isFinite(n) || n <= 0) return;
    setItems((cur) => {
      const found = cur.find((i) => i.productId === productId);
      return found ? cur.map((i) => i.productId === productId ? { ...i, expected: i.expected + n } : i) : [...cur, { productId, expected: n }];
    });
    setQty("");
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!items.length) return;
    actions.createReceiving(number, supplier, items);
    setNumber(""); setSupplier(""); setProductId(""); setQty(""); setItems([]);
  };

  return <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader />
    <section className="glass p-4">
      <div className="font-display text-2xl tracking-[.12em] text-heading mb-4">RECEBIMENTO</div>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input value={number} onChange={e => setNumber(e.target.value)} placeholder="Número da nota" className="field text-sm text-foreground" />
          <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Fornecedor" className="field text-sm text-foreground" />
        </div>
        <div className="grid grid-cols-[1fr_120px_auto] gap-2">
          <select value={productId} onChange={e => setProductId(e.target.value)} className="field text-sm text-foreground">
            <option value="">Selecione o produto</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9,.]/g, ""))} inputMode="decimal" placeholder="Quantidade" className="field text-sm text-foreground" />
          <button type="button" onClick={addItem} className="rounded-xl bg-secondary ring-1 ring-border px-4 font-semibold text-secondary-foreground">Adicionar</button>
        </div>
        {items.length > 0 && <div className="rounded-xl ring-1 ring-border divide-y divide-border/50">
          {items.map(i => { const p = products.find(x => x.id === i.productId)!; return <div key={i.productId} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="flex-1 text-foreground">{p.name}</span><span className="font-mono">{i.expected} {p.unit === "kg" ? "kg" : "un."}</span><button type="button" onClick={() => setItems(items.filter(x => x.productId !== i.productId))} className="text-destructive">×</button></div>; })}
        </div>}
        <button disabled={!items.length} className="w-full rounded-xl bg-primary text-primary-foreground font-bold py-3 disabled:opacity-40">Salvar nota para conferência</button>
      </form>
    </section>

    <section className="glass p-4 mt-4">
      <div className="label-mono mb-3">Notas recebidas</div>
      <div className="divide-y divide-border/50">
        {!notes.length && <p className="py-8 text-center font-mono text-[11px] text-muted-foreground">nenhuma nota cadastrada</p>}
        {notes.map(n => <div key={n.id} className="py-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-56"><div className="font-semibold text-foreground">NF {n.number}</div><div className="font-mono text-[11px] text-muted-foreground">{n.supplier} · {n.items.length} produtos</div></div>
          <span className={`font-mono text-[11px] rounded-md px-2 py-1 ${n.status === "divergente" ? "bg-destructive/15 text-destructive" : n.status === "aceito" || n.status === "conferido" ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground"}`}>{n.status}</span>
          {n.status === "pendente" && <button onClick={() => navigate({ to: "/conferencia", search: { nota: n.id } as any })} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm font-semibold text-secondary-foreground">Conferir</button>}
          {n.status === "divergente" && <div className="flex gap-2"><button onClick={() => actions.acceptReceiving(n.id)} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-bold">Aceitar divergência</button><button onClick={() => actions.rejectReceiving(n.id)} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm font-semibold text-secondary-foreground">Rejeitar</button></div>}
          {n.status === "rejeitado" && <span className="text-[11px] text-muted-foreground">estoque não alterado</span>}
        </div>)}
      </div>
    </section>
  </div>;
}
