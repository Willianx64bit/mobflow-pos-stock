import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Clock3, AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { productHasBarcode, actions, useStore, type Product, type ReceivingNote } from "@/lib/store";

export const Route = createFileRoute("/conferencia")({
  head: () => ({ meta: [{ title: "MobFlow — Conferência" }, { name: "description", content: "Conferência das notas aguardando recebimento." }] }),
  component: Conferencia,
});

function Conferencia() {
  const navigate = useNavigate();
  const notes = useStore((s) => s.receiving ?? []);
  const products = useStore((s) => s.products);
  const search = useSearch({ from: "/conferencia" }) as { nota?: string };
  const [open, setOpen] = useState<string | null>(search.nota ?? null);
  const pending = notes.filter(n => n.status === "pendente");
  const history = notes.filter(n => n.status !== "pendente");
  const note = notes.find(n => n.id === open);

  useEffect(() => { if (search.nota) setOpen(search.nota); }, [search.nota]);

  useEffect(() => {
    let permissions: string[] = [];
    try {
      const stored = JSON.parse(sessionStorage.getItem("mobflow-permissions") || "[]") as string[];
      permissions = Array.from(new Set(stored.map((p) => p === "Conferência" ? "Operações" : p)));
      sessionStorage.setItem("mobflow-permissions", JSON.stringify(permissions));
    } catch {}
    if (!permissions.includes("Operações") && !permissions.includes("Gerência")) navigate({ to: "/" });
  }, [navigate]);

  if (note) return <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader />{note.status === "pendente" ? <Session noteId={note.id} onBack={() => setOpen(null)} /> : <ConferenceMirror note={note} products={products} onBack={() => setOpen(null)} />}</div>;

  return <div className="mfb-in min-h-screen p-4 md:p-6"><AppHeader />
    <section className="glass p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><div className="font-display text-2xl tracking-[.12em] text-heading mb-1">CONFERÊNCIA</div><div className="label-mono">Notas pendentes de recebimento</div></div><button type="button" onClick={() => navigate({ to: "/operacoes" })} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground ring-1 ring-border hover:bg-accent">← Voltar para Operações</button></div>
      
      {!pending.length && <p className="py-10 text-center font-mono text-[11px] text-muted-foreground">nenhuma nota pendente</p>}
      <div className="divide-y divide-border/50">
        {pending.map(n => <button key={n.id} onClick={() => setOpen(n.id)} className="w-full text-left py-4 flex flex-wrap items-center gap-3 hover:bg-accent/30 rounded-lg px-2">
          <div className="flex-1 min-w-56"><div className="font-semibold text-foreground">NF {n.number}</div><div className="font-mono text-[11px] text-muted-foreground">{n.supplier} · {n.items.length} produtos</div></div>
          <span className="font-mono text-[11px] bg-secondary rounded-md px-2 py-1 text-secondary-foreground">Pendente</span>
          <span className="text-primary font-semibold">Abrir →</span>
        </button>)}
      </div>
    </section>
    <section className="glass p-4 mt-4">
      <div className="font-display text-xl tracking-[.1em] text-heading mb-1">HISTÓRICO DE CONFERÊNCIAS</div>
      <div className="label-mono mb-3">Andamento das notas já conferidas</div>
      {!history.length && <p className="py-8 text-center font-mono text-[11px] text-muted-foreground">nenhuma conferência finalizada</p>}
      <div className="divide-y divide-border/50">{history.map(n => {
        const needsAction = !!n.stockReleased && Object.values(n.decisions ?? {}).includes("devolver") && !n.actionCompleted;
        const released = !!n.stockReleased && !needsAction;
        const label = n.actionCompleted ? "Finalizado" : n.status === "analisando" ? "Analisando" : needsAction || n.status === "rejeitado" ? "Ação necessária" : released ? "Liberado" : "Ação necessária";
        return <div key={n.id} className="w-full py-4 flex flex-wrap items-center gap-3 px-2">
          <div className="flex-1 min-w-48"><div className="font-semibold text-foreground">NF {n.number}</div><div className="font-mono text-[11px] text-muted-foreground">{n.supplier} · {n.items.length + (n.extras?.length ?? 0)} produtos</div></div>
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${label==="Liberado" || label==="Finalizado"?"bg-emerald-500/15 text-emerald-700":label==="Ação necessária"?"bg-amber-500/15 text-amber-700":"bg-secondary text-secondary-foreground"}`}>{label==="Liberado" || label==="Finalizado"?<CheckCircle2 className="h-4 w-4"/>:label==="Ação necessária"?<AlertTriangle className="h-4 w-4"/>:<Clock3 className="h-4 w-4"/>}{label}</span>
          <button onClick={() => setOpen(n.id)} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm font-semibold text-secondary-foreground">Ver detalhes</button>
        </div>;
      })}</div>
    </section>
  </div>;
}

function ConferenceMirror({ note, products, onBack }: { note: ReceivingNote; products: Product[]; onBack: () => void }) {
  const conference = useStore(s => s.conferences.find(c => c.receivingId === note.id));
  const needsAction = !!note.stockReleased && Object.values(note.decisions ?? {}).includes("devolver") && !note.actionCompleted;
  const receivedFor = (productId: string, fallback = 0) => {
    const line = note.items.find(i => i.productId === productId);
    const extra = note.extras?.find(i => i.productId === productId);
    return Number(line?.received ?? conference?.counts?.[productId] ?? extra?.received ?? fallback);
  };
  const decisionLabel = (id: string) => note.decisions?.[id] === "aceitar" ? "Aceito" : note.decisions?.[id] === "devolver" ? "Devolver" : "Sem decisão";
  return <section className="glass p-4">
    <div className="flex flex-wrap items-center gap-3 mb-4"><button onClick={onBack} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm text-secondary-foreground">← Voltar para Conferências</button><div className="flex-1"><div className="font-display text-2xl tracking-[.12em] text-heading">NF {note.number}</div><div className="font-mono text-[11px] text-muted-foreground">{note.supplier} · Visualização da conferência</div></div><span className="rounded-md bg-secondary px-2 py-1 text-xs font-semibold text-secondary-foreground">{note.status === "analisando" ? "Analisando" : note.actionCompleted ? "Finalizado" : note.stockReleased && Object.values(note.decisions ?? {}).includes("devolver") ? "Ação necessária" : note.stockReleased ? "Liberado" : note.status}</span></div>
    <p className="mb-3 rounded-lg bg-secondary/50 p-3 text-sm text-muted-foreground">Esta tela é para consulta das quantidades e decisões registradas no Recebimento.</p>
    {needsAction && <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3"><p className="mb-3 text-sm text-amber-800">Confirme aqui quando a ação de devolução dos produtos tiver sido realizada.</p><button onClick={() => { if (confirm("Confirmar que a ação de devolução foi realizada?")) { const completed = actions.finishReceivingAction(note.id); if (completed) onBack(); } }} className="w-full rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold">Ação realizada · Finalizar</button></div>}
    <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr className="label-mono text-left"><th className="py-2">Produto</th><th className="text-right">Esperado</th><th className="text-right">Recebido</th><th className="text-right">Decisão</th></tr></thead><tbody className="divide-y divide-border/50">
      {note.items.map(i => <tr key={i.productId}><td className="py-3"><div className="font-medium text-foreground">{i.name}</div><div className="font-mono text-[10px] text-muted-foreground">{products.find(p => p.id === i.productId)?.code}</div></td><td className="text-right font-mono">{i.expected} {i.unit === "kg" ? "kg" : "un."}</td><td className="text-right font-mono">{receivedFor(i.productId)} {i.unit === "kg" ? "kg" : "un."}</td><td className={"text-right font-semibold " + (note.decisions?.[i.productId] === "aceitar" ? "text-emerald-700" : note.decisions?.[i.productId] === "devolver" ? "text-amber-700" : "text-muted-foreground")}>{decisionLabel(i.productId)}</td></tr>)}
      {(note.extras ?? []).map(i => <tr key={"extra-" + i.productId}><td className="py-3"><div className="font-medium text-foreground">{i.name} <span className="text-[10px] text-amber-700">Extra</span></div><div className="font-mono text-[10px] text-muted-foreground">{products.find(p => p.id === i.productId)?.code || "Sem código"}</div></td><td className="text-right font-mono">0 {i.unit === "kg" ? "kg" : "un."}</td><td className="text-right font-mono">{receivedFor(i.productId, i.received)} {i.unit === "kg" ? "kg" : "un."}</td><td className={"text-right font-semibold " + (note.decisions?.[i.productId] === "aceitar" ? "text-emerald-700" : note.decisions?.[i.productId] === "devolver" ? "text-amber-700" : "text-muted-foreground")}>{decisionLabel(i.productId)}</td></tr>)}
    </tbody></table></div>
    {note.stockReleased && <div className="mt-4 rounded-xl bg-secondary/60 p-3 text-sm">Estoque liberado somente para os produtos aceitos. {Object.values(note.decisions ?? {}).includes("devolver") ? note.actionCompleted ? "A ação de devolução foi marcada como finalizada." : "Há produtos registrados para devolução." : "Não há produtos marcados para devolução."}</div>}
  </section>;
}

function Session({ noteId, onBack }: { noteId: string; onBack: () => void }) {
  const note = useStore(s => s.receiving.find(n => n.id === noteId));
  const products = useStore(s => s.products);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [extraCounts, setExtraCounts] = useState<Record<string, number>>({});
  const [cameraOpen, setCameraOpen] = useState(false);
  const [reopenCamera, setReopenCamera] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<typeof products[number] | null>(null);
  const [productQty, setProductQty] = useState("");
  const [editingQuantity, setEditingQuantity] = useState(false);
  const [productExpiry, setProductExpiry] = useState("");
  const [expiries, setExpiries] = useState<Record<string, string>>({});
  const [extraExpiries, setExtraExpiries] = useState<Record<string, string>>({});

  if (!note) return null;

  const setReceived = (id: string, value: string) => {
    const n = Number(value.replace(",", "."));
    setCounts(c => ({ ...c, [id]: Number.isFinite(n) ? Math.max(0, n) : 0 }));
  };

  const openProduct = (product: typeof products[number]) => {
    setEditingQuantity(false);
    setSelectedProduct(product);
    setProductQty("");
    const isExtra = !note.items.some(i => i.productId === product.id);
    setProductExpiry((isExtra ? extraExpiries : expiries)[product.id] ?? "");
  };

  const editProductQty = (product: typeof products[number]) => {
    const isExtra = !note.items.some(i => i.productId === product.id);
    setEditingQuantity(true);
    setSelectedProduct(product);
    setProductQty(String((isExtra ? extraCounts : counts)[product.id] ?? 0));
    setProductExpiry((isExtra ? extraExpiries : expiries)[product.id] ?? "");
  };

  const clearProductCollection = (product: typeof products[number]) => {
    if (!confirm(`Apagar toda a coleta de "${product.name}"? A quantidade e a validade registradas serão removidas.`)) return;
    const isExtra = !note.items.some(i => i.productId === product.id);
    if (isExtra) {
      setExtraCounts(c => { const next = { ...c }; delete next[product.id]; return next; });
      setExtraExpiries(c => { const next = { ...c }; delete next[product.id]; return next; });
    } else {
      setCounts(c => ({ ...c, [product.id]: 0 }));
      setExpiries(c => { const next = { ...c }; delete next[product.id]; return next; });
    }
    if (selectedProduct?.id === product.id) {
      setSelectedProduct(null);
      setProductQty("");
      setProductExpiry("");
      setEditingQuantity(false);
    }
  };

  const saveProductQty = () => {
    if (!selectedProduct) return;
    const n = Number(productQty.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return;
    const isExtra = !note.items.some(i => i.productId === selectedProduct.id);
    if (isExtra) {
      setExtraCounts(c => ({ ...c, [selectedProduct.id]: (c[selectedProduct.id] ?? 0) + n }));
      if (productExpiry) setExtraExpiries(prev => ({ ...prev, [selectedProduct.id]: productExpiry }));
    } else {
      setCounts(c => ({ ...c, [selectedProduct.id]: editingQuantity ? n : (c[selectedProduct.id] ?? 0) + n }));
      if (productExpiry) setExpiries(prev => ({ ...prev, [selectedProduct.id]: productExpiry }));
    }
    setSelectedProduct(null);
    setProductQty("");
    setProductExpiry("");
    setEditingQuantity(false);
    if (reopenCamera) setCameraOpen(true);
  };

  const finish = () => {
    const saved = actions.saveReceivingConference(note.id, counts, expiries, extraCounts, extraExpiries);
    if (saved) onBack();
    else alert("Não foi possível salvar a conferência. Os dados continuam nesta tela; tente novamente.");
  };

  return <section className="glass p-4">
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <button onClick={onBack} className="rounded-lg bg-secondary ring-1 ring-border px-3 py-1.5 text-sm text-secondary-foreground">← Voltar</button>
      <div className="flex-1"><div className="font-display text-2xl tracking-[.12em] text-heading">NF {note.number}</div><div className="font-mono text-[11px] text-muted-foreground">{note.supplier}</div></div>
      <button onClick={() => setCameraOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2 font-bold"><Camera className="h-4 w-4" /> Câmera</button>
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

    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead><tr className="label-mono text-left"><th className="py-2">Produto</th><th className="text-right">Vai chegar</th><th className="text-right">Recebido</th><th></th></tr></thead>
        <tbody className="divide-y divide-border/50">
          {note.items.map(i => {
            const product = products.find(p => p.id === i.productId);
            return <tr key={i.productId}>
              <td className="py-3"><div className="flex items-start gap-2"><button type="button" onClick={() => product && editProductQty(product)} title="Editar quantidade coletada" className="mt-0.5 rounded-md p-1.5 text-primary hover:bg-accent"><Pencil className="h-4 w-4" /></button><div><button type="button" onClick={() => product && openProduct(product)} className="text-left"><div className="text-foreground font-medium">{i.name}</div><div className="font-mono text-[10px] text-muted-foreground">{product?.code}</div></button><button type="button" onClick={() => product && clearProductCollection(product)} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-destructive hover:underline"><Trash2 className="h-3 w-3" /> Apagar coleta</button></div></div></td>
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
          {products.filter(p => (extraCounts[p.id] ?? 0) > 0 && !note.items.some(i => i.productId === p.id)).map(p => <tr key={"extra-" + p.id} className="bg-amber-500/5"><td className="py-3"><div className="text-foreground font-medium">{p.name}</div><div className="font-mono text-[10px] text-muted-foreground">{p.code}</div><span className="inline-flex mt-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Produto não está na nota</span></td><td className="text-right font-mono">—</td><td className="text-right font-mono font-semibold">{extraCounts[p.id]} {p.unit === "kg" ? "kg" : "un."}</td><td className="text-right"><button type="button" onClick={() => openProduct(p)} className="rounded-lg bg-secondary ring-1 ring-border px-2 py-1 text-xs font-semibold text-secondary-foreground">Adicionar</button></td></tr>)}
        </tbody>
      </table>
    </div>

    {Object.values(extraCounts).some(q => q > 0) && <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800"><b>Produtos extras registrados:</b> eles serão enviados para Recebimento para avaliação do responsável.</div>}
    <div className="mt-4 rounded-xl bg-secondary/60 ring-1 ring-border p-3 text-[12px] text-secondary-foreground">A conferência será salva mesmo se houver divergência.</div>
    <button onClick={() => confirm("Finalizar esta conferência?") && finish()} className="w-full mt-4 rounded-xl bg-primary text-primary-foreground font-bold py-3">Finalizar conferência</button>

    {cameraOpen && <BarcodeScanner products={products} onClose={() => setCameraOpen(false)} onProduct={(p) => { setCameraOpen(false); openProduct(p); }} />}

    {selectedProduct && <div className="mfb-product-modal fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-background ring-1 ring-border p-5 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          {selectedProduct.photo ? <img src={selectedProduct.photo} alt="" className="h-16 w-16 rounded-xl object-cover ring-1 ring-border" /> : <div className="h-16 w-16 rounded-xl bg-secondary grid place-items-center text-xs text-muted-foreground">Sem foto</div>}
          <div className="flex-1"><div className="font-bold text-lg text-foreground">{selectedProduct.name}</div><div className="font-mono text-[11px] text-muted-foreground">Código: {selectedProduct.code}</div></div>
          <button onClick={() => setSelectedProduct(null)} className="text-xl text-muted-foreground">×</button>
        </div>
        {!note.items.some(i => i.productId === selectedProduct.id) && <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800"><b>Produto não está na nota.</b> Será registrado como produto extra para aprovação.</div>}
        <div className="rounded-xl bg-secondary/60 ring-1 ring-border p-3 mb-4">
          <div className="text-[11px] text-muted-foreground">Já coletado</div>
          <div className="text-2xl font-bold text-foreground">{(note.items.some(i => i.productId === selectedProduct.id) ? counts[selectedProduct.id] : extraCounts[selectedProduct.id]) ?? 0} {selectedProduct.unit === "kg" ? "kg" : "un."}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Esperado nesta nota: {note.items.find(i => i.productId === selectedProduct.id)?.expected ?? "não consta"} {selectedProduct.unit === "kg" ? "kg" : "un."}</div>
        </div>
        <div className="label-mono mb-2">{editingQuantity ? "Editar quantidade coletada" : "Quantidade desta coleta"}</div>
        <input autoFocus type="number" min="0" step={selectedProduct.unit === "kg" ? "0.001" : "1"} value={productQty} onChange={e => setProductQty(e.target.value)} className="field w-full text-foreground text-lg font-mono" placeholder="Ex.: 20" />
        <div className="label-mono mt-4 mb-2">Validade (opcional)</div>
        <input type="text" inputMode="numeric" maxLength={10} value={productExpiry} onChange={e => { const d = e.target.value.replace(/\D/g, "").slice(0, 8); setProductExpiry(d.replace(/^(\d{2})(\d)/, "$1/$2").replace(/^(\d{2}\/\d{2})(\d)/, "$1/$2")); }} className="field w-full text-foreground text-lg font-mono" placeholder="DD/MM/AAAA" />
        <div className="mt-1 text-[10px] text-muted-foreground">Digite 10102026 para preencher 10/10/2026. Não é obrigatório.</div>
        <button onClick={saveProductQty} disabled={!productQty || !Number.isFinite(Number(productQty.replace(",", "."))) || Number(productQty.replace(",", ".")) < 0 || (!editingQuantity && Number(productQty.replace(",", ".")) === 0)} className="w-full mt-4 rounded-xl bg-primary text-primary-foreground font-bold py-3 disabled:opacity-40">{editingQuantity ? "Salvar quantidade" : "+ Somar quantidade"}</button>
      </div>
    </div>}
  </section>;
}

function BarcodeScanner({ products, onProduct, onClose }: {
  products: { code: string; name: string; id: string; price: number; stock: number; minStock: number; category: string; unit: "un" | "kg"; ref?: string | undefined; cost?: number | undefined; photo?: string | undefined }[];
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
              const p = products.find(x => productHasBarcode(x, value));
              if (p) { onProduct(p); return; }
              setError(`Código ${value} não encontrado no cadastro de produtos.`);
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
    const p = products.find(x => productHasBarcode(x, code));
    if (p) onProduct(p);
    else setError("Produto não encontrado no cadastro de produtos.");
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
