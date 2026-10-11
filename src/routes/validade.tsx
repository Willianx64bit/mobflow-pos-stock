import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { useStore } from "@/lib/store";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/validade")({
  head: () => ({ meta: [{ title: "MobFlow — Validade dos produtos" }, { name: "description", content: "Produtos recebidos com validade cadastrada." }] }),
  component: ValidadeProdutos,
});

function ValidadeProdutos() {
  const notes = useStore((s) => s.receiving ?? []);
  const products = useStore((s) => s.products);
  const [order, setOrder] = useState<"shortest" | "longest">("shortest");
  const entries = useMemo(() => notes.flatMap((note) =>
    note.items.filter((item) => !!item.expiry).map((item) => ({
      ...item,
      noteNumber: note.number,
      supplier: note.supplier,
    }))
  ), [notes]);

  const parseExpiry = (value: string) => {
    const [day, month, year] = value.split("/").map(Number);
    return new Date(year, month - 1, day).getTime();
  };

  const sortedEntries = [...entries].sort((a, b) =>
    order === "shortest"
      ? parseExpiry(a.expiry!) - parseExpiry(b.expiry!)
      : parseExpiry(b.expiry!) - parseExpiry(a.expiry!)
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
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
        <div className="label-mono mb-4">Produtos com validade informada durante a conferência</div>

        <div className="mb-4">
          <label className="label-mono block mb-2">Ordenar validade</label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setOrder("shortest")} aria-pressed={order === "shortest"} className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${order === "shortest" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground"}`}>
              Mais próxima
            </button>
            <button type="button" onClick={() => setOrder("longest")} aria-pressed={order === "longest"} className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${order === "longest" ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground"}`}>
              Mais distante
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {order === "shortest" ? "Mostrando primeiro os produtos que vencem antes." : "Mostrando primeiro os produtos com validade mais longa."}
          </p>
        </div>

        {!sortedEntries.length && <p className="py-10 text-center text-sm text-muted-foreground">Nenhum produto com validade cadastrada ainda.</p>}
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
                    <div className="text-xs text-muted-foreground">NF {item.noteNumber} · {item.supplier}</div>
                  </div>
                  <span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold ${status.cls}`}>{status.label}</span>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">Quantidade recebida: {item.received ?? 0} {item.unit === "kg" ? "kg" : "un."}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
