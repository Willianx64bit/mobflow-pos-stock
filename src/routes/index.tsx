import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ProductForm } from "@/components/ProductForm";
import { actions, brl, norm, useStore, type Payment, type Product, type Sale } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MobFlow — Ponto de Venda" },
      { name: "description", content: "PDV super rápido do MobFlow: busque, adicione ao carrinho e finalize vendas em segundos." },
      { property: "og:title", content: "MobFlow — Ponto de Venda" },
      { property: "og:description", content: "PDV super rápido com controle de estoque integrado." },
    ],
  }),
  component: PDV,
});

const PAYMENTS: Payment[] = ["Dinheiro", "Cartão", "Pix"];

function PDV() {
  const products = useStore((s) => s.products);
  const cart = useStore((s) => s.cart);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [payment, setPayment] = useState<Payment>("Pix");
  const [received, setReceived] = useState("");
  const [done, setDone] = useState<Sale | null>(null);
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const search = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return products;
    return products.filter((p) => norm(p.name).includes(n) || p.code.includes(n) || norm(p.category).includes(n));
  }, [q, products]);

  const lines = cart.map((c) => ({ ...c, p: products.find((p) => p.id === c.productId)! })).filter((l) => l.p);
  const total = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const recv = Number(received.replace(",", ".")) || 0;
  const low = products.filter((p) => p.stock <= p.minStock);

  const finish = () => {
    if (!lines.length) return;
    if (payment === "Dinheiro" && recv && recv < total) return;
    const s = actions.checkout(payment, payment === "Dinheiro" ? recv || total : undefined);
    if (s) { setDone(s); setReceived(""); setQ(""); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing !== undefined) return;
      if (e.key === "F9") { e.preventDefault(); finish(); }
      else if (e.key === "F8") { e.preventDefault(); actions.clearCart(); }
      else if (e.key === "F6") { e.preventDefault(); setPayment((p) => PAYMENTS[(PAYMENTS.indexOf(p) + 1) % 3]); }
      else if (e.key === "Escape") { setDone(null); setQ(""); search.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => { search.current?.focus(); }, [done, editing]);
  useEffect(() => { setSel(0); }, [q]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const m = q.match(/^(\d+)\*(.*)$/);
      const term = m ? m[2] : q;
      const exact = products.find((p) => p.code === term.trim());
      const target = exact ?? results[sel];
      if (target) { actions.addToCart(target.id, m ? Number(m[1]) : 1); setQ(""); }
      else if (!q && lines.length) finish();
    }
  };

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="grid lg:grid-cols-[1fr_380px] gap-4">
        <section className="glass p-4">
          <div className="flex items-center gap-3 field px-4 py-3">
            <span className="font-mono text-[11px] text-primary">/</span>
            <input
              ref={search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Buscar nome, código ou bipar… (ex: 3*cafe)"
              className="flex-1 bg-transparent outline-none text-[15px] text-foreground placeholder:text-muted-foreground"
            />
            <span className="ml-auto font-mono text-[10px] text-muted-foreground whitespace-nowrap">
              {results.length} produtos · <kbd className="text-subtle">↵</kbd> adiciona
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 mt-4 max-h-[calc(100vh-330px)] overflow-y-auto pr-1">
            {results.map((p, i) => {
              const out = p.stock <= 0;
              return (
                <button
                  key={p.id}
                  onClick={() => { actions.addToCart(p.id); search.current?.focus(); }}
                  onContextMenu={(e) => { e.preventDefault(); setEditing(p); }}
                  className={`text-left rounded-xl bg-muted ring-1 p-3 transition-shadow duration-150 hover:ring-primary/50 ${i === sel && q ? "ring-primary" : "ring-border"} ${out ? "opacity-50" : ""}`}
                >
                  <div className="aspect-[4/3] rounded-lg bg-surface ring-1 ring-border/50 grid place-items-center text-[11px] uppercase tracking-[.15em] text-muted-foreground">
                    {p.name.split(" ")[0]}
                  </div>
                  <div className="mt-2 text-[13px] font-semibold text-foreground line-clamp-1">{p.name}</div>
                  <div className="flex justify-between font-mono text-[11px] mt-0.5">
                    <span className="text-subtle">{brl(p.price)}</span>
                    <span className={p.stock <= p.minStock ? "text-destructive" : "text-muted-foreground"}>×{p.stock}</span>
                  </div>
                </button>
              );
            })}
            <button onClick={() => setEditing(null)} className="rounded-xl ring-1 ring-dashed ring-primary/40 p-3 grid place-items-center text-primary text-sm font-semibold hover:bg-primary/5 min-h-32">
              + Novo produto
            </button>
          </div>

          {low.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[11px]">
              <span className="text-destructive">⚠ estoque baixo:</span>
              {low.slice(0, 6).map((p) => (
                <button key={p.id} onClick={() => setEditing(p)} className="rounded-md bg-destructive/10 px-2 py-0.5 text-destructive hover:bg-destructive/20">
                  {p.name} ({p.stock})
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 font-mono text-[10px] text-muted-foreground">↑↓ navegar · 3*código multiplica · botão direito edita · F6 pagamento · F8 limpar · F9 finalizar</p>
        </section>

        <aside className="glass p-4 flex flex-col lg:sticky lg:top-6 lg:max-h-[calc(100vh-130px)]">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <span className="font-display text-[20px] tracking-[.12em] text-heading">CARRINHO</span>
            <span className="font-mono text-[11px] text-muted-foreground">{count} itens</span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-border/50 min-h-32">
            {lines.length === 0 && <p className="py-10 text-center font-mono text-[11px] text-muted-foreground">carrinho vazio — busque ou clique num produto</p>}
            {lines.map(({ p, qty }) => (
              <div key={p.id} className="py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-foreground truncate">{p.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{brl(p.price)} × {qty} = <span className="text-subtle">{brl(p.price * qty)}</span></div>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg bg-secondary ring-1 ring-border px-1.5 py-1">
                  <button onClick={() => actions.addToCart(p.id, -1)} className="h-6 w-6 rounded-md grid place-items-center text-subtle hover:bg-accent">−</button>
                  <span className="font-mono text-[13px] text-foreground w-6 text-center">{qty}</span>
                  <button onClick={() => actions.addToCart(p.id, 1)} className="h-6 w-6 rounded-md grid place-items-center text-subtle hover:bg-accent">+</button>
                </div>
                <button onClick={() => actions.removeFromCart(p.id)} className="text-muted-foreground hover:text-destructive text-sm" aria-label="Remover">×</button>
              </div>
            ))}
          </div>
          <div className="pt-3 border-t border-border">
            <div className="flex justify-between items-baseline">
              <span className="label-mono">Total</span>
              <span className="font-display text-[40px] leading-none text-heading">R$ {brl(total)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              {PAYMENTS.map((m) => (
                <button key={m} onClick={() => setPayment(m)}
                  className={`rounded-lg py-2.5 text-[12px] font-semibold ring-1 transition-colors ${payment === m ? "bg-primary/15 ring-primary/50 text-primary" : "bg-secondary ring-border text-secondary-foreground hover:text-foreground"}`}>
                  {m}
                </button>
              ))}
            </div>
            {payment === "Dinheiro" && (
              <div className="mt-3 flex items-center gap-2">
                <input value={received} onChange={(e) => setReceived(e.target.value)} inputMode="decimal" placeholder="Valor recebido"
                  className="field flex-1 font-mono text-sm text-foreground" onKeyDown={(e) => e.key === "Enter" && finish()} />
                <div className="font-mono text-[12px] text-right">
                  <div className="label-mono">troco</div>
                  <div className={recv && recv < total ? "text-destructive" : "text-primary"}>{brl(Math.max(0, recv - total))}</div>
                </div>
              </div>
            )}
            <button onClick={finish} disabled={!lines.length}
              className="mt-3 w-full rounded-xl bg-primary text-primary-foreground font-bold text-[15px] py-3.5 flex items-center justify-center gap-2 hover:bg-primary/85 disabled:opacity-40">
              Finalizar venda <kbd className="font-mono text-[11px] opacity-70">F9</kbd>
            </button>
          </div>
        </aside>
      </main>

      {done && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4" onClick={() => setDone(null)}>
          <div className="mfb-in w-full max-w-sm rounded-2xl bg-popover ring-1 ring-primary/40 p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto h-14 w-14 rounded-full bg-primary/15 ring-1 ring-primary/50 grid place-items-center text-primary text-2xl">✓</div>
            <h2 className="mt-3 font-display text-3xl tracking-[.12em] text-heading">VENDA CONCLUÍDA</h2>
            <p className="font-mono text-[12px] text-muted-foreground">{done.payment} · {done.items.length} itens</p>
            <p className="mt-3 font-display text-5xl text-primary">R$ {brl(done.total)}</p>
            {done.received && done.received > done.total && (
              <p className="mt-2 font-mono text-sm text-foreground">Troco: R$ {brl(done.received - done.total)}</p>
            )}
            <button autoFocus onClick={() => setDone(null)} className="mt-5 w-full rounded-xl bg-primary text-primary-foreground font-bold py-3">
              Nova venda <kbd className="font-mono text-[11px] opacity-70">ESC</kbd>
            </button>
          </div>
        </div>
      )}
      {editing !== undefined && <ProductForm product={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
