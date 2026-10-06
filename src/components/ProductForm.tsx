import { useEffect, useRef, useState } from "react";
import { actions, type Product } from "@/lib/store";

type Props = { product?: Product | null; onClose: () => void };

export function ProductForm({ product, onClose }: Props) {
  const [f, setF] = useState({
    name: product?.name ?? "",
    code: product?.code ?? "",
    ref: product?.ref ?? "",
    category: product?.category ?? "",
    price: product ? String(product.price).replace(".", ",") : "",
    cost: product?.cost != null ? String(product.cost).replace(".", ",") : "",
    stock: product ? String(product.stock).replace(".", ",") : "",
    minStock: product ? String(product.minStock).replace(".", ",") : "5",
    unit: product?.unit ?? "un",
  });
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const num = (s: string) => Number(s.replace(",", ".")) || 0;
  const weight = (s: string) => {
    const v = s.trim().toLowerCase().replace(",", ".");
    if (/^\d+(?:\.\d+)?\s*g$/.test(v)) return Number(v.replace(/g$/, "").trim()) / 1000;
    if (/^\d+(?:\.\d+)?\s*kg$/.test(v)) return Number(v.replace(/kg$/, "").trim());
    if (/^\d+(?:\.\d+)?$/.test(v)) return Number(v);
    return null;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    const stock = f.unit === "kg" ? weight(f.stock) : num(f.stock);
    const minStock = f.unit === "kg" ? weight(f.minStock) : num(f.minStock);
    if (f.unit === "kg" && (stock === null || minStock === null || stock < 0 || minStock < 0)) return;

    actions.saveProduct({
      id: product?.id,
      name: f.name.trim(),
      ref: f.ref.trim() || undefined,
      code: f.code.trim() || String(Date.now()).slice(-10),
      category: f.category.trim() || "Geral",
      price: num(f.price),
      cost: f.cost.trim() ? num(f.cost) : undefined,
      stock: f.unit === "kg" ? stock! : Math.round(stock),
      minStock: f.unit === "kg" ? minStock! : Math.round(minStock),
      unit: f.unit,
    });
    onClose();
  };

  const input = (key: keyof typeof f, label: string, opts: { mono?: boolean; ref?: boolean; mode?: "decimal" | "numeric" } = {}) => (
    <label className="flex flex-col gap-1.5">
      <span className="label-mono">{label}</span>
      <input
        ref={opts.ref ? first : undefined}
        inputMode={opts.mode}
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
        className={`field text-sm text-foreground ${opts.mono ? "font-mono" : ""}`}
      />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="mfb-in w-full max-w-md rounded-2xl bg-popover ring-1 ring-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl tracking-[.12em] text-heading">{product ? "EDITAR PRODUTO" : "NOVO PRODUTO"}</h2>
          <kbd className="font-mono text-[10px] text-muted-foreground">ESC</kbd>
        </div>
        {input("name", "Nome", { ref: true })}
        <div className="grid grid-cols-2 gap-3">
          {input("code", "Código de barras", { mono: true, mode: "numeric" })}
          {input("ref", "REF (opcional)", { mono: true })}
        </div>
        {input("category", "Categoria")}
        <label className="flex flex-col gap-1.5">
          <span className="label-mono">Tipo de venda</span>
          <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as "un" | "kg" })} className="field text-sm text-foreground">
            <option value="un">Unidade</option>
            <option value="kg">Peso (kg/g)</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          {input("price", f.unit === "kg" ? "Preço por kg R$" : "Preço R$", { mono: true, mode: "decimal" })}
          {input("cost", f.unit === "kg" ? "Custo por kg R$" : "Custo R$ (opcional)", { mono: true, mode: "decimal" })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {input("stock", f.unit === "kg" ? "Estoque (kg ou g)" : "Estoque", { mono: true, mode: "decimal" })}
          {input("minStock", f.unit === "kg" ? "Mínimo (kg ou g)" : "Mínimo", { mono: true, mode: "decimal" })}
        </div>
        {f.unit === "kg" && <p className="font-mono text-[10px] text-primary">Produto por peso: 2 = 2 kg, 500g = 0,5 kg. O preço é por kg.</p>}
        <div className="flex gap-2 pt-1">
          {product && (
            <button type="button" onClick={() => { if (confirm("Excluir este produto?")) { actions.deleteProduct(product.id); onClose(); } }}
              className="rounded-xl px-4 py-3 text-sm font-semibold text-destructive ring-1 ring-destructive/40 hover:bg-destructive/10">Excluir</button>
          )}
          <button type="submit" className="flex-1 rounded-xl bg-primary text-primary-foreground font-bold py-3 hover:bg-primary/85">
            Salvar <kbd className="font-mono text-[11px] opacity-70">↵</kbd>
          </button>
        </div>
      </form>
    </div>
  );
}
