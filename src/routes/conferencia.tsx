import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { CameraScanner } from "@/components/CameraScanner";
import { actions, norm, useStore } from "@/lib/store";

export const Route = createFileRoute("/conferencia")({
  head: () => ({
    meta: [
      { title: "MobFlow — Conferência de Estoque" },
      { name: "description", content: "Faça a conferência do estoque bipando ou usando a câmera e ajuste as diferenças no MobFlow." },
      { property: "og:title", content: "MobFlow — Conferência de Estoque" },
      { property: "og:description", content: "Contagem de estoque com coleta pela câmera." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Conferencias,
});

function Conferencias() {
  const confs = useStore((s) => s.conferences ?? []);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const current = confs.find((c) => c.id === open);

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      {current ? <Session id={current.id} onBack={() => setOpen(null)} /> : (
        <section className="glass p-4">
          <div className="label-mono mb-3">Nova conferência</div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setOpen(actions.newConference(name.trim())); setName(""); }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex: Corredor 2, Mensal outubro)" className="field flex-1 text-sm text-foreground" />
            <button className="rounded-xl bg-primary text-primary-foreground font-bold px-5">Iniciar</button>
          </form>
          <div className="label-mono mt-6 mb-2">Conferências</div>
          <div className="divide-y divide-border/50">
            {confs.length === 0 && <p className="py-8 text-center font-mono text-[11px] text-muted-foreground">nenhuma conferência ainda</p>}
            {confs.map((c) => {
              const items = Object.values(c.counts).reduce((a, b) => a + b, 0);
              return (
                <div key={c.id} className="py-3 flex flex-wrap items-center gap-3 text-[13px]">
                  <button onClick={() => setOpen(c.id)} className="flex-1 text-left min-w-40">
                    <div className="font-semibold text-foreground">{c.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{new Date(c.date).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {Object.keys(c.counts).length} produtos · {items} un.</div>
                  </button>
                  <span className={`font-mono text-[11px] rounded-md px-2 py-0.5 ${c.status === "aberta" ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground"}`}>
                    {c.status}{c.adjusted ? " · ajustada" : ""}
                  </span>
                  <button onClick={() => confirm("Excluir conferência?") && actions.deleteConference(c.id)} className="text-muted-foreground hover:text-destructive" aria-label="Excluir">×</button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function Session({ id, onBack }: { id: string; onBack: () => void }) {
  const conf = useStore((s) => s.conferences.find((c) => c.id === id))!;
  const products = useStore((s) => s.products);
  const [code, setCode] = useState("");
  const [cam, setCam] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<"todos" | "diferenca" | "contados">("todos");
  const input = useRef<HTMLInputElement>(null);
  const closed = conf.status === "finalizada";
  useEffect(() => { input.current?.focus(); }, [cam]);

  const scan = (raw: string) => {
    const m = raw.match(/^(\d+)\*(.*)$/);
    const c = (m ? m[2] : raw)?.trim() ?? "";
    if (!c) return;
    const p = actions.countCode(id, c, m ? Number(m[1]) : 1);
    setFlash(p ? { ok: true, text: `+${m ? m[1] : 1} ${p.name}` } : { ok: false, text: `código não cadastrado: ${c}` });
  };

  const rows = products.map((p) => {
    const counted = conf.counts[p.id];
    return { p, counted, diff: counted === undefined ? null : counted - p.stock };
  }).filter((r) => filter === "todos" ? true : filter === "contados" ? r.counted !== undefined : r.diff !== null && r.diff !== 0);
  const diffs = products.filter((p) => conf.counts[p.id] !== undefined && conf.counts[p.id] !== p.stock).length;

  return (
    <section className="glass p-4">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button onClick={onBack} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm text-secondary-foreground">← Voltar</button>
        <span className="font-display text-2xl tracking-[.12em] text-heading flex-1">{conf.name.toUpperCase()}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{Object.keys(conf.counts).length}/{products.length} contados · {diffs} com diferença</span>
      </div>

      {!closed && (
        <div className="flex gap-2">
          <form className="flex-1 flex items-center gap-3 field px-4 py-3" onSubmit={(e) => { e.preventDefault(); scan(code); setCode(""); }}>
            <span className="font-mono text-[11px] text-primary">▮▮</span>
            <input ref={input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Bipe o código (ex: 12*7891000100)" className="flex-1 bg-transparent outline-none text-[15px] text-foreground placeholder:text-muted-foreground" />
          </form>
          <button onClick={() => setCam(true)} className="rounded-xl bg-primary text-primary-foreground font-bold px-4">📷 Câmera</button>
        </div>
      )}
      {flash && <p className={`mt-2 font-mono text-[12px] ${flash.ok ? "text-primary" : "text-destructive"}`}>{flash.text}</p>}
      {conf.unknown.length > 0 && <p className="mt-2 font-mono text-[11px] text-destructive">⚠ não cadastrados: {conf.unknown.join(", ")}</p>}

      <div className="flex gap-2 mt-4 mb-2">
        {(["todos", "contados", "diferenca"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 ${filter === f ? "bg-primary/15 ring-primary/50 text-primary" : "bg-secondary ring-border text-secondary-foreground"}`}>
            {f === "diferenca" ? "com diferença" : f}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="label-mono text-left"><th className="py-2">Produto</th><th className="text-right">Sistema</th><th className="text-right">Contado</th><th className="text-right">Diferença</th></tr></thead>
          <tbody className="divide-y divide-border/50">
            {rows.sort((a, b) => norm(a.p.name).localeCompare(norm(b.p.name))).map(({ p, counted, diff }) => (
              <tr key={p.id}>
                <td className="py-2"><div className="text-foreground">{p.name}</div><div className="font-mono text-[10px] text-muted-foreground">{p.code}</div></td>
                <td className="text-right font-mono text-muted-foreground">{p.stock}</td>
                <td className="text-right">
                  <input type="number" disabled={closed} value={counted ?? ""} placeholder="—"
                    onChange={(e) => actions.setCount(id, p.id, Number(e.target.value))}
                    className="field w-20 text-right font-mono text-sm text-foreground py-1" />
                </td>
                <td className={`text-right font-mono ${diff === null ? "text-muted-foreground" : diff === 0 ? "text-primary" : "text-destructive"}`}>
                  {diff === null ? "—" : diff > 0 ? `+${diff}` : diff}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!closed ? (
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={() => confirm("Finalizar e ajustar o estoque para as quantidades contadas?") && actions.finishConference(id, true)} className="flex-1 rounded-xl bg-primary text-primary-foreground font-bold py-3">Finalizar e ajustar estoque</button>
          <button onClick={() => actions.finishConference(id, false)} className="rounded-xl bg-secondary ring-1 ring-border text-secondary-foreground font-semibold px-4 py-3">Finalizar sem ajustar</button>
        </div>
      ) : <p className="mt-4 font-mono text-[11px] text-muted-foreground">conferência finalizada{conf.adjusted ? " — estoque ajustado" : ""}</p>}

      {cam && <CameraScanner title="Coleta" onCode={scan} onClose={() => setCam(false)} />}
    </section>
  );
}
