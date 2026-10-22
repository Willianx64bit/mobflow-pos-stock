import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { actions, useStore } from "@/lib/store";
import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/validade")({
  head: () => ({ meta: [{ title: "MobFlow — Validade dos produtos" }, { name: "description", content: "Produtos recebidos com validade cadastrada." }] }),
  component: ValidadeProdutos,
});

function ValidadeProdutos() {
  const notes = useStore((s) => s.receiving ?? []);
  const products = useStore((s) => s.products);
  const manualExpiries = useStore((s) => s.manualExpiries ?? []);
  const [order, setOrder] = useState<"shortest" | "longest" | "expired">("shortest");
  const [showAdd, setShowAdd] = useState(false);
  const [productId, setProductId] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [expiryDate, setExpiryDate] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [formError, setFormError] = useState("");
  const entries = useMemo(() => [
    ...notes.filter((note) => note.source !== "manual").flatMap((note) =>
      note.items.filter((item) => !!item.expiry).map((item) => ({
        ...item,
        noteNumber: note.number,
        supplier: note.supplier,
        source: note.source,
        noteId: note.id,
      }))
    ),
    ...manualExpiries.map((item) => ({
      productId: item.productId,
      name: item.name,
      expected: item.quantity,
      received: item.quantity,
      expiry: item.expiry,
      unit: item.unit,
      noteNumber: "Cadastro manual",
      supplier: "",
      source: "manual" as const,
      noteId: item.id,
    })),
  ], [notes, manualExpiries]);

  const selectedProduct = products.find((p) => p.id === productId);
  const availableQuantity = selectedProduct
    ? Math.max(0, selectedProduct.stock - manualExpiries.filter((e) => e.productId === productId && e.id !== editingNoteId).reduce((sum, e) => sum + e.quantity, 0))
    : 0;

  const parseExpiry = (value: string) => {
    const [day, month, year] = value.split("/").map(Number);
    return new Date(year, month - 1, day).getTime();
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sortedEntries = [...entries]
    .filter((item) => {
      if (order !== "expired") return true;
      const expiryDate = new Date(parseExpiry(item.expiry!));
      expiryDate.setHours(0, 0, 0, 0);
      return expiryDate.getTime() < today.getTime();
    })
    .sort((a, b) =>
      order === "longest"
        ? parseExpiry(b.expiry!) - parseExpiry(a.expiry!)
        : parseExpiry(a.expiry!) - parseExpiry(b.expiry!)
    );
  const getStatus = (expiry: string) => {
    const date = new Date(parseExpiry(expiry));
    date.setHours(0, 0, 0, 0);
    const days = Math.ceil((date.getTime() - today.getTime()) / 86400000);
    return days < 0
      ? { label: "Vencido", cls: "text-destructive bg-destructive/10" }
      : days <= 30
        ? { label: "Vence em breve", cls: "text-amber-700 bg-amber-500/10 dark:text-amber-300" }
        : { label: "Dentro da validade", cls: "text-primary bg-primary/10" };
  };

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <section className="glass p-4">
        <div className="font-display text-2xl tracking-[.12em] text-heading mb-1">VALIDADE DOS PRODUTOS</div>
        <div className="label-mono mb-4">Produtos com validade cadastrada</div>

        <button type="button" onClick={() => {
          if (showAdd && editingNoteId) {
            setEditingNoteId(null);
            setProductId("");
            setProductSearch("");
            setExpiryDate("");
            setQuantity("1");
          }
          setShowAdd((v) => !v);
          setFormError("");
        }} className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">
          <Plus className="h-4 w-4 text-green-600" /> Adicionar validade manualmente
        </button>

        {showAdd && (
          <form className="mb-5 space-y-3 rounded-xl border border-border p-4" onSubmit={(e) => {
            e.preventDefault();
            setFormError("");
            const qty = Number(quantity.replace(",", "."));
            if (!productId || !expiryDate || !Number.isFinite(qty) || qty <= 0 || qty > availableQuantity) {
              setFormError("Selecione o produto, informe a validade e uma quantidade dentro do estoque disponível.");
              return;
            }
            const result = editingNoteId
              ? actions.updateManualExpiry(editingNoteId, productId, expiryDate, qty)
              : actions.addManualExpiry(productId, expiryDate, qty);
            if (result) {
              setShowAdd(false);
              setEditingNoteId(null);
              setProductId("");
              setProductSearch("");
              setProductPickerOpen(false);
              setExpiryDate("");
              setQuantity("1");
            } else {
              setFormError("Não foi possível cadastrar essa validade.");
            }
          }}>
            <div className="relative">
              <div className="font-semibold text-foreground">{editingNoteId ? "Editar validade manual" : "Nova validade manual"}</div>
              <label className="block text-sm font-medium" htmlFor="expiry-product-search">Produto</label>
              <input
                id="expiry-product-search"
                required
                autoComplete="off"
                value={productSearch}
                onFocus={() => setProductPickerOpen(true)}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  setProductId("");
                  setProductPickerOpen(true);
                }}
                placeholder="Pesquisar por código ou descrição..."
                className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-foreground"
              />
              {productPickerOpen && (
                <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
                  {products.filter((p) => {
                    const query = productSearch.trim().toLocaleLowerCase("pt-BR");
                    return !query || p.name.toLocaleLowerCase("pt-BR").includes(query) || (p.code.toLocaleLowerCase("pt-BR").includes(query) || (p.barcodes ?? []).some((code) => code.toLocaleLowerCase("pt-BR").includes(query)));
                  }).slice(0, 50).map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => {
                        setProductId(p.id);
                        setProductSearch(`${p.name} (${p.code})`);
                        setProductPickerOpen(false);
                      }}
                      className={`block w-full border-b border-border/60 px-3 py-3 text-left text-sm last:border-0 hover:bg-accent ${productId === p.id ? "bg-accent" : ""}`}
                    >
                      <span className="block font-medium text-foreground">{p.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{p.code}</span>
                    </button>
                  ))}
                  {products.filter((p) => {
                    const query = productSearch.trim().toLocaleLowerCase("pt-BR");
                    return !query || p.name.toLocaleLowerCase("pt-BR").includes(query) || p.code.toLocaleLowerCase("pt-BR").includes(query);
                  }).length === 0 && <p className="p-3 text-sm text-muted-foreground">Nenhum produto encontrado.</p>}
                </div>
              )}
              {productId && <p className="mt-1 text-xs text-muted-foreground">Produto selecionado.</p>}
            </div>
            <label className="block text-sm font-medium">Data de validade
              <input required type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-foreground" />
            </label>
            <label className="block text-sm font-medium">Quantidade com esta validade
              {selectedProduct && <span className="ml-2 text-xs font-normal text-muted-foreground">Disponível para distribuir: {availableQuantity} {selectedProduct.unit === "kg" ? "kg" : "un."} · Estoque total: {selectedProduct.stock} {selectedProduct.unit === "kg" ? "kg" : "un."}</span>}
              <input required type="number" min="0.001" max={selectedProduct ? availableQuantity : undefined} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-foreground" />
            </label>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowAdd(false); setEditingNoteId(null); setProductId(""); setProductSearch(""); setExpiryDate(""); setQuantity("1"); }} className="flex-1 rounded-xl border border-border px-3 py-2.5">Cancelar</button>
              <button type="submit" className="flex-1 rounded-xl bg-primary px-3 py-2.5 font-semibold text-primary-foreground">{editingNoteId ? "Salvar alterações" : "Salvar validade"}</button>
            </div>
          </form>
        )}

        <div className="mb-4">
          <label className="label-mono block mb-2">Ordenar validade</label>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => setOrder("shortest")} aria-pressed={order === "shortest"} className={`rounded-xl border px-2 py-2.5 text-sm font-semibold transition-colors ${order === "shortest" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground"}`}>
              Mais próxima
            </button>
            <button type="button" onClick={() => setOrder("longest")} aria-pressed={order === "longest"} className={`rounded-xl border px-2 py-2.5 text-sm font-semibold transition-colors ${order === "longest" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground"}`}>
              Mais distante
            </button>
            <button type="button" onClick={() => setOrder("expired")} aria-pressed={order === "expired"} className={`rounded-xl border px-2 py-2.5 text-sm font-semibold transition-colors ${order === "expired" ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-foreground"}`}>
              Vencidos
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {order === "shortest"
              ? "Mostrando primeiro os produtos que vencem antes."
              : order === "longest"
                ? "Mostrando primeiro os produtos com validade mais longa."
                : "Mostrando somente produtos com a validade já vencida."}
          </p>
        </div>

        {!sortedEntries.length && <p className="py-10 text-center text-sm text-muted-foreground">{order === "expired" ? "Nenhum produto vencido encontrado." : "Nenhum produto com validade cadastrada ainda."}</p>}
        <div className="space-y-3">
          {sortedEntries.map((item, index) => {
            const product = products.find((p) => p.id === item.productId);
            const status = getStatus(item.expiry!);
            return (
              <div key={item.productId + item.noteNumber + index} className="rounded-xl ring-1 ring-border p-3">
                <div className="flex items-start gap-3">
                  {product?.photo
                    ? <img src={product.photo} alt="" className="h-12 w-12 rounded-lg object-cover ring-1 ring-border" />
                    : <div className="h-12 w-12 rounded-lg bg-secondary grid place-items-center text-xs text-muted-foreground">Sem foto</div>}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-foreground">{item.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{product?.code || item.productId}</div>
                    <div className="mt-2 text-sm">Validade: <b>{item.expiry}</b></div>
                    <div className="text-xs text-muted-foreground">{item.source === "manual" ? "Cadastro manual" : <>NF {item.noteNumber} · {item.supplier}</>}</div>
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold ${status.cls}`}>{status.label}</span>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">{item.source === "manual" ? "Quantidade contada" : "Quantidade recebida"}: {item.received ?? 0} {item.unit === "kg" ? "kg" : "un."}</div>
                {item.source === "manual" && (
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" aria-label="Editar validade" title="Editar validade" onClick={() => {
                      const [day, month, year] = (item.expiry ?? "").split("/");
                      setEditingNoteId(item.noteId);
                      setProductId(item.productId);
                      setProductSearch(`${item.name} (${products.find((p) => p.id === item.productId)?.code ?? ""})`);
                      setExpiryDate(year && month && day ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : "");
                      setQuantity(String(item.received ?? item.expected ?? 1));
                      setFormError("");
                      setShowAdd(true);
                      setProductPickerOpen(false);
                    }} className="grid h-10 w-10 place-items-center rounded-lg border border-green-600/30 text-green-600 hover:bg-green-600/10">
                      <Pencil className="h-[18px] w-[18px]" aria-hidden="true" />
                    </button>
                    <button type="button" aria-label="Excluir validade" title="Excluir validade" onClick={() => {
                      if (window.confirm("Deseja excluir este cadastro de validade?")) actions.deleteManualExpiry(item.noteId);
                    }} className="grid h-10 w-10 place-items-center rounded-lg border border-destructive/40 text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
