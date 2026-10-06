import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, useStore } from "@/lib/store";

export const Route = createFileRoute("/conferencia")({
  head: () => ({ meta: [{ title: "MobFlow — Conferência" }, { name: "description", content: "Conferência das notas aguardando recebimento." }] }),
  component: Conferencia,
});

function Conferencia() {
  const notes = useStore((s) => s.receiving ?? []);
  const products = useStore((s) => s.products);
  const search = useSearch({ from: "/conferencia" }) as { nota?: string };
  const [open, setOpen] = useState<string | null>(search.nota ?? null);
  const pending = notes.filter(n => n.status === "pendente");
  const note = notes.find(n => n.id === open);

  useEffect(() => { if (search.nota) setOpen(search.nota); }, [search.nota]);

  if (note) return <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader /><Session noteId={note.id} onBack={() => setOpen(null)} /></div>;

  return <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader />
    <section className="glass p-4">
      <div className="font-display text-2xl tracking-[.12em] text-heading mb-1">CONFERÊNCIA</div>
      <div className="label-mono mb-4">Notas pendentes de recebimento</div>
      {!pending.length && <p className="py-10 text-center font-mono text-[11px] text-muted-foreground">nenhuma nota pendente</p>}
      <div className="divide-y divide-border/50">
        {pending.map(n => <button key={n.id} onClick={() => setOpen(n.id)} className="w-full text-left py-4 flex flex-wrap items-center gap-3 hover:bg-accent/30 rounded-lg px-2">
          <div className="flex-1 min-w-56"><div className="font-semibold text-foreground">NF {n.number}</div><div className="font-mono text-[11px] text-muted-foreground">{n.supplier} · {n.items.length} produtos</div></div>
          <span className="font-mono text-[11px] bg-secondary rounded-md px-2 py-1 text-secondary-foreground">Pendente</span>
          <span className="text-primary font-semibold">Abrir →</span>
        </button>)}
      </div>
    </section>
  </div>;
}

function Session({ noteId, onBack }: { noteId: string; onBack: () => void }) {
  const note = useStore(s => s.receiving.find(n => n.id === noteId));
  const products = useStore(s => s.products);
  const [counts, setCounts] = useState<Record<string, number>>({});
  if (!note) return null;

  const setReceived = (id: string, value: string) => {
    const n = Number(value.replace(",", "."));
    setCounts(c => ({ ...c, [id]: Number.isFinite(n) ? Math.max(0, n) : 0 }));
  };
  const finish = () => {
    const cid = actions.startReceivingConference(note.id);
    if (!cid) return;
    for (const i of note.items) actions.setCount(cid, i.productId, counts[i.productId] ?? 0);
    actions.finishReceivingConference(cid);
    onBack();
  };

  return <section className="glass p-4">
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <button onClick={onBack} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm text-secondary-foreground">← Voltar</button>
      <div className="flex-1"><div className="font-display text-2xl tracking-[.12em] text-heading">NF {note.number}</div><div className="font-mono text-[11px] text-muted-foreground">{note.supplier}</div></div>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead><tr className="label-mono text-left"><th className="py-2">Produto</th><th className="text-right">Vai chegar</th><th className="text-right">Recebido</th></tr></thead>
        <tbody className="divide-y divide-border/50">
          {note.items.map(i => <tr key={i.productId}>
            <td className="py-3"><div className="text-foreground">{i.name}</div><div className="font-mono text-[10px] text-muted-foreground">{products.find(p => p.id === i.productId)?.code}</div></td>
            <td className="text-right font-mono">{i.expected} {i.unit === "kg" ? "kg" : "un."}</td>
            <td className="text-right"><input type="number" min="0" step={i.unit === "kg" ? "0.001" : "1"} value={counts[i.productId] ?? ""} onChange={e => setReceived(i.productId, e.target.value)} placeholder="0" className="field w-24 text-right font-mono text-sm text-foreground py-1" /></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="mt-4 rounded-xl bg-secondary/60 ring-1 ring-border p-3 text-[12px] text-secondary-foreground">A conferência será salva mesmo se houver diferença. Quando houver divergência, o estoque ficará aguardando sua aprovação em <b>Recebimento</b>.</div>
    <button onClick={() => confirm("Finalizar esta conferência?") && finish()} className="w-full mt-4 rounded-xl bg-primary text-primary-foreground font-bold py-3">Finalizar conferência</button>
  </section>;
}
