import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, useStore, type ReceivingNote } from "@/lib/store";

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

 <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader />  const search = useSearch({ from: "/recebimento" }) as { nota?: string };\n  const selectedId = search.nota || "";
  const selected = notes.find(n => n.id === selectedId);
  if (selected) return <ReceivingDetail note={selected} onBack={() => navigate({ to: "/recebimento" })} />;

  return
    <section className="glass p-4">
      <div className="font-display text-2xl tracking-[.12em] text-heading mb-4">RECEBIMENTO</div>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input value={number} onChange={e => setNumber(e.target.value)} placeholder="Número da nota" required className="field text-sm text-foreground" />
          <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Fornecedor" required className="field text-sm text-foreground" />
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
          <div className="flex-1 min-w-56">
            <div className="font-semibold text-foreground">NF {n.number}</div>
            <div className="font-mono text-[11px] text-muted-foreground">{n.supplier} · {n.items.length} produtos</div>
          </div>
          <span className={`font-mono text-[11px] rounded-md px-2 py-1 ${n.status === "divergente" ? "bg-destructive/15 text-destructive" : n.status === "aceito" || n.status === "conferido" ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground"}`}>{n.status}</span>
          <button onClick={() => navigate({ to: "/recebimento", search: { nota: n.id } as any })} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm font-semibold text-secondary-foreground">Abrir</button>
          {n.status === "pendente" && <button onClick={() => navigate({ to: "/conferencia", search: { nota: n.id } as any })} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-semibold">Conferir</button>}
          {n.status === "divergente" && <div className="flex gap-2"><button onClick={() => actions.acceptReceiving(n.id)} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-bold">Aceitar divergência</button><button onClick={() => actions.rejectReceiving(n.id)} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm font-semibold text-secondary-foreground">Rejeitar</button></div>}
          {n.status === "rejeitado" && <span className="text-[11px] text-muted-foreground">estoque não alterado</span>}
        </div>)}
      </div>
    </section>
  </div>;
}

function ReceivingDetail({ note, onBack }: { note: ReceivingNote; onBack: () => void }) {
  const products = useStore((s) => s.products);
  const conference = useStore((s) => s.conferences.find(c => c.receivingId === note.id));
  const receivedByProduct = new Map(note.items.map((i: any) => [i.productId, i.received ?? conference?.counts?.[i.productId] ?? 0]));
  return <section className="glass p-4 mt-4">
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <button onClick={onBack} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm text-secondary-foreground">← Voltar</button>
      <div className="flex-1"><div className="font-display text-2xl tracking-[.12em] text-heading">NF {note.number}</div><div className="font-mono text-[11px] text-muted-foreground">{note.supplier}</div></div>
      <span className="font-mono text-[11px] rounded-md px-2 py-1 bg-secondary text-secondary-foreground">{note.status}</span>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
      <div className="rounded-xl bg-secondary/60 p-3"><div className="label-mono">Produtos</div><div className="text-lg font-bold text-foreground">{note.items.length}</div></div>
      <div className="rounded-xl bg-secondary/60 p-3"><div className="label-mono">Esperado</div><div className="text-lg font-bold text-foreground">{note.items.reduce((s: number, i: any) => s + i.expected, 0)}</div></div>
      <div className="rounded-xl bg-secondary/60 p-3"><div className="label-mono">Recebido</div><div className="text-lg font-bold text-foreground">{note.items.reduce((s: number, i: any) => s + Number(receivedByProduct.get(i.productId) || 0), 0)}</div></div>
      <div className="rounded-xl bg-secondary/60 p-3"><div className="label-mono">Situação</div><div className="text-lg font-bold text-foreground">{note.status}</div></div>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]"><thead><tr className="label-mono text-left"><th className="py-2">Produto</th><th className="text-right">Esperado</th><th className="text-right">Recebido</th><th className="text-right">Diferença</th></tr></thead>
      <tbody className="divide-y divide-border/50">{note.items.map((i: any) => { const received=Number(receivedByProduct.get(i.productId)||0); const diff=received-i.expected; const p=products.find(x=>x.id===i.productId); return <tr key={i.productId}><td className="py-3"><div className="text-foreground">{i.name}</div><div className="font-mono text-[10px] text-muted-foreground">{p?.code}</div></td><td className="text-right font-mono">{i.expected} {i.unit==="kg"?"kg":"un."}</td><td className="text-right font-mono">{received} {i.unit==="kg"?"kg":"un."}</td><td className={`text-right font-mono ${diff===0?"text-primary":"text-destructive"}`}>{diff>0?"+":""}{diff} {i.unit==="kg"?"kg":"un."}</td></tr>; })}</tbody></table>
    </div>
    {note.status === "divergente" && <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => actions.acceptReceiving(note.id)} className="rounded-xl bg-primary text-primary-foreground px-4 py-2 font-bold">Aceitar divergência e liberar estoque</button><button onClick={() => actions.rejectReceiving(note.id)} className="rounded-xl bg-secondary ring-1 ring-border px-4 py-2 font-semibold text-secondary-foreground">Rejeitar</button></div>}
  </section>;
}
