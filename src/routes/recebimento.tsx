import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, useStore, type ReceivingNote } from "@/lib/store";

export const Route = createFileRoute("/recebimento")({
  head: () => ({ meta: [{ title: "MobFlow — Recebimento" }, { name: "description", content: "Cadastro e aprovação de notas recebidas." }] }),
  component: Recebimento,
});

function Recebimento() {
  const products = useStore((s) => s.products);
  const notes = useStore((s) => s.receiving ?? []);
  const suppliers = useStore((s) => s.suppliers ?? []);
  const navigate = useNavigate();
  const search = useSearch({ from: "/recebimento" }) as { nota?: string };
  const [number, setNumber] = useState("");
  const [supplier, setSupplier] = useState("");
  const [supplierCnpj, setSupplierCnpj] = useState("");
  const [showNewNote, setShowNewNote] = useState(false);
  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [qty, setQty] = useState("");
  const [items, setItems] = useState<{ productId: string; expected: number }[]>([]);
  const supplierSuggestions = useMemo(() => { const term = supplier.trim().toLowerCase(); return suppliers.filter(s => !term || s.name.toLowerCase().includes(term)).slice(0, 8); }, [suppliers, supplier]);
  const formatCnpj = (value: string) => { const d = value.replace(/\D/g, "").slice(0, 14); return d.replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2"); };

  const selected = notes.find(n => n.id === search.nota);
  if (selected) return <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader /><ReceivingDetail note={selected} onBack={() => navigate({ to: "/recebimento" })} /></div>;

  const productSuggestions = products.filter(p => {
    const term = productSearch.trim().toLowerCase();
    return !term || p.name.toLowerCase().includes(term) || p.code.includes(term);
  }).slice(0, 8);

  const addItem = () => {
    const n = Number(qty.replace(",", "."));
    if (!productId || !Number.isFinite(n) || n <= 0) return;
    setItems((cur) => {
      const found = cur.find((i) => i.productId === productId);
      return found ? cur.map((i) => i.productId === productId ? { ...i, expected: i.expected + n } : i) : [...cur, { productId, expected: n }];
    });
    setQty("");
    setProductId("");
    setProductSearch("");
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!items.length) return;
    actions.createReceiving(number, supplier, supplierCnpj || undefined, items);
    setNumber(""); setSupplier(""); setSupplierCnpj(""); setProductId(""); setQty(""); setItems([]); setShowNewNote(false);
  };

  return <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader />
    <section className="glass p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="font-display text-2xl tracking-[.12em] text-heading">RECEBIMENTO</div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowNewNote(v => !v)} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">{showNewNote ? "− Fechar" : "+ Nova nota"}</button>
          <button onClick={() => navigate({ to: "/gerencia" })} className="rounded-xl bg-secondary px-4 py-2 text-sm text-secondary-foreground hover:bg-accent">← Voltar para gerência</button>
        </div>
      </div>
      {!showNewNote && <p className="text-sm text-muted-foreground">Cadastre uma nova nota somente quando precisar. As notas já recebidas ficam abaixo.</p>}
      {showNewNote && <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input value={number} onChange={e => setNumber(e.target.value)} placeholder="Número da nota" required className="field text-sm text-foreground" />
          <div className="relative">
            <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Fornecedor" required className="field text-sm text-foreground" />
            {supplier && !supplierCnpj && supplierSuggestions.length > 0 && <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-xl bg-background ring-1 ring-border shadow-xl">{supplierSuggestions.map(s => <button key={s.name} type="button" onClick={() => { setSupplier(s.name); setSupplierCnpj(s.cnpj || ""); }} className="w-full px-3 py-2 text-left text-sm hover:bg-accent border-b border-border/40 last:border-0"><span className="font-medium text-foreground">{s.name}</span>{s.cnpj && <span className="ml-2 font-mono text-xs text-muted-foreground">{s.cnpj}</span>}</button>)}</div>}
          </div>
          <input value={supplierCnpj} onChange={e => setSupplierCnpj(formatCnpj(e.target.value))} placeholder="CNPJ (opcional)" inputMode="numeric" className="field text-sm text-foreground" />
        </div>
        <div className="grid grid-cols-[1fr_120px_auto] gap-2">
          <div className="relative">
            <input value={productSearch} onChange={e => { setProductSearch(e.target.value); if (!e.target.value) setProductId(""); }} placeholder="Pesquisar produto ou código" className="field w-full text-sm text-foreground" />
            {productSearch && !productId && <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-xl bg-background ring-1 ring-border shadow-xl">
              {productSuggestions.map(p => <button key={p.id} type="button" onClick={() => { setProductId(p.id); setProductSearch(p.name); }} className="w-full px-3 py-2 text-left text-sm hover:bg-accent border-b border-border/40 last:border-0"><span className="font-medium text-foreground">{p.name}</span><span className="ml-2 font-mono text-xs text-muted-foreground">{p.code}</span></button>)}
              {!productSuggestions.length && <div className="px-3 py-3 text-xs text-muted-foreground">Nenhum produto encontrado.</div>}
            </div>}
          </div>
          <input value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9,.]/g, ""))} inputMode="decimal" placeholder="Quantidade" className="field text-sm text-foreground" />
          <button type="button" onClick={addItem} className="rounded-xl bg-secondary ring-1 ring-border px-4 font-semibold text-secondary-foreground">Adicionar</button>
        </div>
        {items.length > 0 && <div className="rounded-xl ring-1 ring-border divide-y divide-border/50">
          {items.map(i => { const p = products.find(x => x.id === i.productId)!; return <div key={i.productId} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="flex-1 text-foreground">{p.name}</span><span className="font-mono">{i.expected} {p.unit === "kg" ? "kg" : "un."}</span><button type="button" onClick={() => setItems(items.filter(x => x.productId !== i.productId))} className="text-destructive">×</button></div>; })}
        </div>}
        <button disabled={!items.length} className="w-full rounded-xl bg-primary text-primary-foreground font-bold py-3 disabled:opacity-40">Salvar nota para conferência</button>
      </form>}
    </section>

    <section className="glass p-4 mt-4">
      <div className="label-mono mb-3">Notas recebidas</div>
      <div className="divide-y divide-border/50">
        {!notes.length && <p className="py-8 text-center font-mono text-[11px] text-muted-foreground">nenhuma nota cadastrada</p>}
        {notes.map(n => <div key={n.id} className="py-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-56"><div className="font-semibold text-foreground">NF {n.number}</div><div className="font-mono text-[11px] text-muted-foreground">{n.supplier}{n.supplierCnpj ? ` · ${n.supplierCnpj}` : ""} · {n.items.length} produtos</div></div>
          <span className={`font-mono text-[11px] rounded-md px-2 py-1 ${n.status === "divergente" ? "bg-destructive/15 text-destructive" : n.status === "aceito" || n.status === "conferido" ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground"}`}>{n.status}</span>
          <button onClick={() => navigate({ to: "/recebimento", search: { nota: n.id } as any })} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm font-semibold text-secondary-foreground">Abrir</button>
          {n.status === "pendente" && <button onClick={() => navigate({ to: "/conferencia", search: { nota: n.id } as any })} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-semibold">Conferir</button>}
          {(n.status === "divergente" || n.status === "conferido") && <div className="flex gap-2"><button onClick={() => actions.acceptReceiving(n.id)} disabled={!!n.stockReleased} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-bold disabled:opacity-50">{n.stockReleased ? "Estoque já liberado" : "Aceitar e liberar estoque"}</button>{!n.stockReleased && <button onClick={() => actions.rejectReceiving(n.id)} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm font-semibold text-secondary-foreground">Rejeitar</button>}</div>}
          {n.status === "rejeitado" && <span className="text-[11px] text-muted-foreground">estoque não alterado</span>}
        </div>)}
      </div>
    </section>
  </div>;
}
function ReceivingDetail({ note, onBack }: { note: ReceivingNote; onBack: () => void }) {
  const products = useStore((s) => s.products);
  const conference = useStore((s) => s.conferences.find(c => c.receivingId === note.id));
  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [qty, setQty] = useState("");
  const productSuggestions = products.filter(p => {
    const term = productSearch.trim().toLowerCase();
    return !term || p.name.toLowerCase().includes(term) || p.code.includes(term);
  }).slice(0, 8);
  const addProduct = () => {
    const n = Number(qty.replace(",", "."));
    if (!productId || !Number.isFinite(n) || n <= 0) return;
    actions.addReceivingItems(note.id, [{ productId, expected: n }]);
    setProductId("");
    setProductSearch("");
    setQty("");
  };
  const receivedByProduct = new Map(note.items.map((i: any) => [i.productId, i.received ?? conference?.counts?.[i.productId] ?? 0]));
  return <section className="glass p-4 mt-4">
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <button onClick={onBack} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm text-secondary-foreground">← Voltar</button>
      <div className="flex-1"><div className="font-display text-2xl tracking-[.12em] text-heading">NF {note.number}</div><div className="font-mono text-[11px] text-muted-foreground">{note.supplier}{note.supplierCnpj ? ` · CNPJ ${note.supplierCnpj}` : ""}</div></div>
      <span className="font-mono text-[11px] rounded-md px-2 py-1 bg-secondary text-secondary-foreground">{note.status}</span>
      {(note.status === "divergente" || note.status === "conferido") && <div className="flex flex-wrap gap-2 ml-auto">
        <button onClick={() => actions.acceptReceiving(note.id)} disabled={!!note.stockReleased} className="rounded-xl bg-primary text-primary-foreground px-4 py-2 font-bold disabled:opacity-50">{note.stockReleased ? "Estoque já liberado" : "✓ Aceitar e liberar estoque"}</button>
        {!note.stockReleased && <button onClick={() => actions.rejectReceiving(note.id)} className="rounded-xl bg-secondary ring-1 ring-border px-4 py-2 font-semibold text-secondary-foreground">Rejeitar</button>}
      </div>}
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
      <div className="rounded-xl bg-secondary/60 p-3"><div className="label-mono">Produtos</div><div className="text-lg font-bold text-foreground">{note.items.length}</div></div>
      <div className="rounded-xl bg-secondary/60 p-3"><div className="label-mono">Esperado</div><div className="text-lg font-bold text-foreground">{note.items.reduce((s: number, i: any) => s + i.expected, 0)}</div></div>
      <div className="rounded-xl bg-secondary/60 p-3"><div className="label-mono">Recebido</div><div className="text-lg font-bold text-foreground">{note.items.reduce((s: number, i: any) => s + Number(receivedByProduct.get(i.productId) || 0), 0)}</div></div>
      <div className="rounded-xl bg-secondary/60 p-3"><div className="label-mono">Situação</div><div className="text-lg font-bold text-foreground">{note.status}</div></div>
    </div>
    {note.status === "pendente" && <div className="mt-4 rounded-xl bg-secondary/50 ring-1 ring-border p-3">
      <div className="font-semibold text-foreground mb-2">Adicionar produtos à nota</div>
      <div className="grid grid-cols-[1fr_120px_auto] gap-2">
        <div className="relative">
          <input value={productSearch} onChange={e => { setProductSearch(e.target.value); if (!e.target.value) setProductId(""); }} placeholder="Pesquisar produto ou código" className="field w-full text-sm text-foreground" />
          {productSearch && !productId && <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-xl bg-background ring-1 ring-border shadow-xl">
            {productSuggestions.map(p => <button key={p.id} type="button" onClick={() => { setProductId(p.id); setProductSearch(p.name); }} className="w-full px-3 py-2 text-left text-sm hover:bg-accent border-b border-border/40 last:border-0"><span className="font-medium text-foreground">{p.name}</span><span className="ml-2 font-mono text-xs text-muted-foreground">{p.code}</span></button>)}
            {!productSuggestions.length && <div className="px-3 py-3 text-xs text-muted-foreground">Nenhum produto encontrado.</div>}
          </div>}
        </div>
        <input value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9,.]/g, ""))} inputMode="decimal" placeholder="Quantidade" className="field text-sm text-foreground" />
        <button type="button" onClick={addProduct} disabled={!productId || !qty} className="rounded-xl bg-primary text-primary-foreground px-4 py-2 font-bold disabled:opacity-40">+ Adicionar</button>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">Pode incluir produtos depois de salvar, enquanto a conferência ainda não foi finalizada.</div>
    </div>}
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]"><thead><tr className="label-mono text-left"><th className="py-2">Produto</th><th className="text-right">Esperado</th><th className="text-right">Recebido</th><th className="text-right">Diferença</th></tr></thead>
      <tbody className="divide-y divide-border/50">{note.items.map((i: any) => { const received=Number(receivedByProduct.get(i.productId)||0); const diff=received-i.expected; const p=products.find(x=>x.id===i.productId); return <tr key={i.productId}><td className="py-3"><div className="text-foreground">{i.name}</div><div className="font-mono text-[10px] text-muted-foreground">{p?.code}</div></td><td className="text-right font-mono">{i.expected} {i.unit==="kg"?"kg":"un."}</td><td className="text-right font-mono">{received} {i.unit==="kg"?"kg":"un."}</td><td className={`text-right font-mono ${diff===0?"text-primary":"text-destructive"}`}>{diff>0?"+":""}{diff} {i.unit==="kg"?"kg":"un."}</td></tr>; })}</tbody></table>
    </div>
  </section>;
}
