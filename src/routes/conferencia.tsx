import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
  const [cameraOpen, setCameraOpen] = useState(false);
  const [reopenCamera, setReopenCamera] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<typeof products[number] | null>(null);
  const [productQty, setProductQty] = useState("");

  if (!note) return null;

  const setReceived = (id: string, value: string) => {
    const n = Number(value.replace(",", "."));
    setCounts(c => ({ ...c, [id]: Number.isFinite(n) ? Math.max(0, n) : 0 }));
  };

  const openProduct = (product: typeof products[number]) => {
    setSelectedProduct(product);
    setProductQty("");
  };

  const saveProductQty = () => {
    if (!selectedProduct) return;
    const n = Number(productQty.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return;
    setCounts(c => ({ ...c, [selectedProduct.id]: (c[selectedProduct.id] ?? 0) + n }));
    setSelectedProduct(null);
    setProductQty("");
    if (reopenCamera) setCameraOpen(true);
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
      <button onClick={() => setCameraOpen(true)} className="rounded-xl bg-primary text-primary-foreground px-4 py-2 font-bold">📷 Câmera</button>
      <label className="flex items-center gap-2 rounded-xl bg-secondary ring-1 ring-border px-3 py-2 text-sm text-secondary-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={reopenCamera}
          onChange={e => setReopenCamera(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        Reabrir câmera após salvar
      </label>
    </div>

    <div className="rounded-xl bg-secondary/60 ring-1 ring-border p-3 mb-4 text-[12px] text-secondary-foreground">
      Use a câmera para ler o código de barras. O produto será aberto para você informar a quantidade recebida e salvar.
    </div>

    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead><tr className="label-mono text-left"><th className="py-2">Produto</th><th className="text-right">Vai chegar</th><th className="text-right">Recebido</th><th></th></tr></thead>
        <tbody className="divide-y divide-border/50">
          {note.items.map(i => {
            const product = products.find(p => p.id === i.productId);
            return <tr key={i.productId}>
              <td className="py-3"><button type="button" onClick={() => product && openProduct(product)} className="text-left"><div className="text-foreground font-medium">{i.name}</div><div className="font-mono text-[10px] text-muted-foreground">{product?.code}</div></button></td>
              <td className="text-right font-mono">{i.expected} {i.unit === "kg" ? "kg" : "un."}</td>
              <td className="text-right">
                <div className="font-mono font-semibold">{counts[i.productId] ?? 0} {i.unit === "kg" ? "kg" : "un."}</div>
                <div className="text-[10px] text-muted-foreground">
                  {Math.max(0, i.expected - (counts[i.productId] ?? 0)) > 0
                    ? "Falta " + Math.max(0, i.expected - (counts[i.productId] ?? 0)) + " " + (i.unit === "kg" ? "kg" : "un.")
                    : "Quantidade completa"}
                </div>
              </td>
              <td className="text-right"><button type="button" onClick={() => product && openProduct(product)} className="rounded-lg bg-secondary ring-1 ring-border px-2 py-1 text-xs font-semibold text-secondary-foreground">Abrir</button></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>

    <div className="mt-4 rounded-xl bg-secondary/60 ring-1 ring-border p-3 text-[12px] text-secondary-foreground">A conferência será salva mesmo se houver diferença. Quando houver divergência, o estoque ficará aguardando sua aprovação em <b>Recebimento</b>.</div>
    <button onClick={() => confirm("Finalizar esta conferência?") && finish()} className="w-full mt-4 rounded-xl bg-primary text-primary-foreground font-bold py-3">Finalizar conferência</button>

    {cameraOpen && <BarcodeScanner products={products} allowedIds={new Set(note.items.map(i => i.productId))} onClose={() => setCameraOpen(false)} onProduct={(p) => { setCameraOpen(false); openProduct(p); }} />}

    {selectedProduct && <div className="mfb-product-modal fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-background ring-1 ring-border p-5 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          {selectedProduct.photo ? <img src={selectedProduct.photo} alt="" className="h-16 w-16 rounded-xl object-cover ring-1 ring-border" /> : <div className="h-16 w-16 rounded-xl bg-secondary grid place-items-center text-xs text-muted-foreground">Sem foto</div>}
          <div className="flex-1"><div className="font-bold text-lg text-foreground">{selectedProduct.name}</div><div className="font-mono text-[11px] text-muted-foreground">Código: {selectedProduct.code}</div></div>
          <button onClick={() => setSelectedProduct(null)} className="text-xl text-muted-foreground">×</button>
        </div>
        <div className="rounded-xl bg-secondary/60 ring-1 ring-border p-3 mb-4">
          <div className="text-[11px] text-muted-foreground">Já coletado</div>
          <div className="text-2xl font-bold text-foreground">{counts[selectedProduct.id] ?? 0} {selectedProduct.unit === "kg" ? "kg" : "un."}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Esperado nesta nota: {note.items.find(i => i.productId === selectedProduct.id)?.expected ?? 0} {selectedProduct.unit === "kg" ? "kg" : "un."}</div>
        </div>
        <div className="label-mono mb-2">Quantidade desta coleta</div>
        <input autoFocus type="number" min="0" step={selectedProduct.unit === "kg" ? "0.001" : "1"} value={productQty} onChange={e => setProductQty(e.target.value)} className="field w-full text-foreground text-lg font-mono" placeholder="Ex.: 20" />
        <button onClick={saveProductQty} disabled={!productQty} className="w-full mt-4 rounded-xl bg-primary text-primary-foreground font-bold py-3 disabled:opacity-40">+ Somar quantidade</button>
      </div>
    </div>}
  </section>;
}

function BarcodeScanner({ products, allowedIds, onProduct, onClose }: {
  products: { code: string; name: string; id: string; price: number; stock: number; minStock: number; category: string; unit: "un" | "kg"; ref?: string; cost?: number; photo?: string }[];
  allowedIds: Set<string>;
  onProduct: (product: (typeof products)[number]) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [manualCode, setManualCode] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let active = true;

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Câmera não disponível neste navegador.");
        const BarcodeDetectorCtor = (window as any).BarcodeDetector;
        if (!BarcodeDetectorCtor) throw new Error("Leitura automática de código não é compatível neste navegador. Use o campo abaixo.");
        const detector = new BarcodeDetectorCtor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!active || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const scan = async () => {
          if (!active || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const value = codes?.[0]?.rawValue?.trim();
            if (value) {
              const p = products.find(x => x.code === value);
              if (p && allowedIds.has(p.id)) { onProduct(p); return; }
              setError(`Código ${value} não pertence aos produtos desta nota.`);
            }
          } catch {}
          timer = window.setTimeout(scan, 350);
        };
        scan();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não foi possível abrir a câmera.");
      }
    };
    start();
    return () => { active = false; if (timer) window.clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
  }, [products, onProduct]);

  const findManual = () => {
    const code = manualCode.trim();
    const p = products.find(x => x.code === code);
    if (p && allowedIds.has(p.id)) onProduct(p);
    else setError("Produto não encontrado ou não pertence aos produtos desta nota.");
  };

  return <div className="fixed inset-0 z-50 bg-black/80 p-4 flex items-center justify-center">
    <div className="w-full max-w-lg rounded-2xl bg-background p-4 ring-1 ring-border">
      <div className="flex items-center gap-3 mb-3"><div className="flex-1 font-bold text-foreground">Ler código do produto</div><button onClick={onClose} className="text-2xl text-muted-foreground">×</button></div>
      <div className="aspect-video overflow-hidden rounded-xl bg-black ring-1 ring-border"><video ref={videoRef} muted playsInline className="h-full w-full object-cover" /></div>
      <p className="mt-3 text-xs text-muted-foreground">Aponte a câmera para o código de barras.</p>
      <div className="mt-3 flex gap-2"><input value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={e => e.key === "Enter" && findManual()} placeholder="Ou digite o código" className="field flex-1 text-foreground" /><button onClick={findManual} className="rounded-xl bg-secondary ring-1 ring-border px-4 font-semibold text-secondary-foreground">Buscar</button></div>
      {error && <div className="mt-3 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{error}</div>}
    </div>
  </div>;
}
