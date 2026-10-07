import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { CameraScanner } from "@/components/CameraScanner";
import { ProductForm } from "@/components/ProductForm";
import { actions, brl, formatCpf, norm, printReceipt, useStore, type Payment, type Product, type Sale } from "@/lib/store";

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
  const settings = useStore((s) => s.settings);
  const cart = useStore((s) => s.cart);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [payment, setPayment] = useState<Payment>("Pix");
  const [received, setReceived] = useState("");
  const [customer, setCustomer] = useState("");
  const [cpf, setCpf] = useState("");
  const [discountType, setDiscountType] = useState<"R$" | "%">("R$");
  const [discountInput, setDiscountInput] = useState("");
  const [quick, setQuick] = useState(false);
  const [cam, setCam] = useState(false);
  const [flash, setFlash] = useState("");
  const [done, setDone] = useState<Sale | null>(null);
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [pendingWeight, setPendingWeight] = useState<Product | null>(null);
  const [weightInput, setWeightInput] = useState("");
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuick(localStorage.getItem("mobflow:quick") === "1");
    return () => { if (scanTimer.current) clearTimeout(scanTimer.current); };
  }, []);
  const toggleQuick = () => setQuick((v) => { localStorage.setItem("mobflow:quick", v ? "0" : "1"); return !v; });

  const parseWeight = (value: string) => {
    const digits = value.replace(/\D/g, "");
    return digits ? Number(digits) / 1000 : null;
  };
  const weightGrams = Math.max(0, Number(weightInput.replace(/\D/g, "")) || 0);
  const weightKg = weightGrams / 1000;
  const weightDisplay = weightGrams >= 1000
    ? `${Math.floor(weightGrams / 1000)} kg${weightGrams % 1000 ? ` ${weightGrams % 1000} g` : ""}`
    : `${weightGrams} g`;
  const addWeightDigit = (digit: string) => {
    setWeightInput((v) => {
      const digits = `${v.replace(/\D/g, "")}${digit}`.replace(/^0+(?=\d)/, "");
      return digits;
    });
  };
  const removeWeightDigit = () => {
    setWeightInput((v) => {
      const digits = v.replace(/\D/g, "").slice(0, -1);
      return digits;
    });
  };
  const requestAdd = (p: Product) => {
    if (p.unit === "kg") { setPendingWeight(p); setWeightInput(""); return; }
    actions.addToCart(p.id, 1);
    setFlash(`+1 ${p.name}`);
  };
  const confirmWeight = () => {
    if (!pendingWeight) return;
    const kg = parseWeight(weightInput);
    if (kg === null || kg <= 0) { setFlash("Informe o peso"); return; }
    if (kg > pendingWeight.stock) { setFlash(`Peso maior que o estoque: ${brl(pendingWeight.stock)} kg`); return; }
    actions.addToCart(pendingWeight.id, kg);
    setFlash(`+${brl(kg)} kg ${pendingWeight.name}`);
    setPendingWeight(null);
    setWeightInput("");
  };
  const scanAdd = (code: string) => {
    const normalized = code.trim();
    const now = Date.now();
    if (!normalized) return false;
    if (lastScanRef.current?.code === normalized && now - lastScanRef.current.at < 500) return true;
    lastScanRef.current = { code: normalized, at: now };
    const p = products.find((x) => x.code === normalized);
    if (p) { requestAdd(p); return true; }
    setFlash(`código não cadastrado: ${normalized}`);
    return false;
  };
  const onChangeQ = (v: string) => {
    setQ(v);
    if (!quick) return;
    if (scanTimer.current) clearTimeout(scanTimer.current);
    const value = v.trim();
    if (!/^\d{6,}$/.test(value)) return;
    scanTimer.current = setTimeout(() => {
      if (products.some((p) => p.code === value)) { scanAdd(value); setQ(""); }
    }, 120);
  };

  const results = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return products;
    return products.filter((p) => norm(p.name).includes(n) || p.code.includes(n) || norm(p.category).includes(n));
  }, [q, products]);

  const lines = cart.map((c) => ({ ...c, p: products.find((p) => p.id === c.productId)! })).filter((l) => l.p);
  const subtotal = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
  const discountNumber = Number(discountInput.replace(",", ".")) || 0;
  const discount = discountType === "%" ? subtotal * Math.min(100, Math.max(0, discountNumber)) / 100 : Math.min(subtotal, Math.max(0, discountNumber));
  const total = Math.max(0, subtotal - discount);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const recv = Number(received.replace(",", ".")) || 0;

  const finish = () => {
    if (!lines.length) return;
    if (payment === "Dinheiro" && recv && recv < total) return;
    const s = actions.checkout(payment, payment === "Dinheiro" ? recv || total : undefined, customer.trim(), cpf, discountNumber, discountType);
    if (s) { setDone(s); setReceived(""); setQ(""); setCustomer(""); setCpf(""); setDiscountInput(""); setDiscountType("R$"); setFlash(""); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing !== undefined || cam) return;
      if (e.key === "F9") { e.preventDefault(); finish(); }
      else if (e.key === "F8") { e.preventDefault(); actions.clearCart(); }
      else if (e.key === "F6") { e.preventDefault(); setPayment((p) => PAYMENTS[(PAYMENTS.indexOf(p) + 1) % 3] ?? "Pix"); }
      else if (e.key === "Escape") { setDone(null); setQ(""); search.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => { search.current?.focus(); }, [done, editing]);
  useEffect(() => { setSel(0); }, [q]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && scanTimer.current) {
      clearTimeout(scanTimer.current);
      scanTimer.current = null;
      const value = q.trim();
      if (/^\d{6,}$/.test(value) && products.some((p) => p.code === value)) {
        e.preventDefault();
        scanAdd(value);
        setQ("");
        return;
      }
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const m = q.match(/^(\d+)\*(.*)$/);
      const term = (m ? m[2] : q) ?? "";
      const exact = products.find((p) => p.code === term.trim());
      const target = exact ?? results[sel];
      if (target) { if (m && target.unit === "un") { const qty = Number(m[1]); if (qty > 0) actions.addToCart(target.id, qty); } else requestAdd(target); setQ(""); }
      else if (!q && lines.length) finish();
    }
  };

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      {(settings.companyName || settings.companyLogo) && (
        <div className="mb-4 glass px-4 py-3 flex items-center gap-3">
          {settings.companyLogo && <img src={settings.companyLogo} alt="" className="h-11 w-11 rounded-xl object-contain bg-background ring-1 ring-border" />}
          {settings.companyName && <div className="font-display text-xl tracking-[.08em] text-heading truncate">{settings.companyName}</div>}
        </div>
      )}
      <main className="grid lg:grid-cols-[1fr_380px] gap-4">
        <section className="glass p-4">
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-3 field px-4 py-3">
              <span className="font-mono text-[11px] text-primary">/</span>
              <input
                ref={search}
                value={q}
                onChange={(e) => onChangeQ(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Buscar nome, código ou bipar… (ex: 3*cafe)"
                className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-foreground placeholder:text-muted-foreground"
              />
              <span className="ml-auto font-mono text-[10px] text-muted-foreground whitespace-nowrap hidden sm:inline">
                {results.length} produtos · <kbd className="text-subtle">↵</kbd> adiciona
              </span>
            </div>
            <button onClick={() => setCam(true)} className="rounded-xl bg-secondary ring-1 ring-border px-3 text-sm text-secondary-foreground hover:text-foreground" aria-label="Ler com câmera">📷</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button onClick={toggleQuick} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-semibold ring-1 ${quick ? "bg-primary/15 ring-primary/50 text-primary" : "bg-secondary ring-border text-secondary-foreground"}`}>
              <span className={`h-3 w-6 rounded-full relative ${quick ? "bg-primary" : "bg-muted"}`}><span className={`absolute top-0.5 h-2 w-2 rounded-full bg-background transition-all ${quick ? "left-3.5" : "left-0.5"}`} /></span>
              Bipe rápido {quick ? "ligado" : "desligado"}
            </button>
            {flash && <span className={`font-mono text-[11px] ${flash.startsWith("+") ? "text-primary" : "text-destructive"}`}>{flash}</span>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 mt-4 max-h-[calc(100vh-330px)] overflow-y-auto pr-1">
            {results.map((p, i) => {
              const out = p.stock <= 0;
              return (
                <button
                  key={p.id}
                  onClick={() => { requestAdd(p); search.current?.focus(); }}
                  onContextMenu={(e) => { e.preventDefault(); setEditing(p); }}
                  className={`text-left rounded-xl bg-muted ring-1 p-3 flex flex-col transition-shadow duration-150 hover:ring-primary/50 ${i === sel && q ? "ring-primary" : "ring-border"} ${out ? "opacity-50" : ""}`}
                >
                  <div className="aspect-[4/3] rounded-lg bg-surface ring-1 ring-border/50 overflow-hidden grid place-items-center text-[11px] uppercase tracking-[.15em] text-muted-foreground">
                    {p.photo ? <img src={p.photo} alt="" className="h-full w-full object-cover" /> : p.name.split(" ")[0]}
                  </div>
                  <div className="mt-2 text-[13px] font-semibold text-foreground line-clamp-1">{p.name}</div>
                  <div className="mt-auto pt-2 text-center">
                    <div className="text-xl font-bold leading-none text-heading">{p.unit === "kg" ? `R$ ${brl(p.price)} kg` : `R$ ${brl(p.price)}`}</div>
                    <div className={`mt-1 font-mono text-[11px] ${p.stock <= p.minStock ? "text-destructive" : "text-muted-foreground"}`}>
                      {p.unit === "kg" ? `${brl(p.stock)}kg` : `${p.stock}un`}
                    </div>
                  </div>
                </button>
              );
            })}
            <button onClick={() => setEditing(null)} className="rounded-xl ring-1 ring-dashed ring-primary/40 p-3 grid place-items-center text-primary text-sm font-semibold hover:bg-primary/5 min-h-32">
              + Novo produto
            </button>
          </div>
          <p className="mt-3 font-mono text-[10px] text-muted-foreground">↑↓ navegar · 3*código multiplica · botão direito edita · F6 pagamento · F8 limpar · F9 finalizar</p>
        </section>

        <aside className="glass p-4 flex flex-col lg:sticky lg:top-6 lg:max-h-[calc(100vh-130px)]">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <span className="font-display text-[20px] tracking-[.12em] text-heading">CHECKOUT</span>
            <span className="font-mono text-[11px] text-muted-foreground">{count} itens</span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-border/50 min-h-32">
            {lines.length === 0 && <p className="py-10 text-center font-mono text-[11px] text-muted-foreground">carrinho vazio — busque ou clique num produto</p>}
            {lines.map(({ p, qty }) => (
              <div key={p.id} className="py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-foreground truncate">{p.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{p.unit === "kg" ? `${brl(p.price)}/kg × ${brl(qty)}kg` : `${brl(p.price)} × ${qty}`} = <span className="text-subtle">{brl(p.price * qty)}</span></div>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg bg-secondary ring-1 ring-border px-1.5 py-1">
                  <button type="button" onClick={() => actions.addToCart(p.id, p.unit === "kg" ? -0.1 : -1)} className="h-6 w-6 rounded-md grid place-items-center text-subtle hover:bg-accent">−</button>
                  <input
                    value={qtyDrafts[p.id] ?? (p.unit === "kg" ? brl(qty) : String(qty))}
                    onChange={(e) => setQtyDrafts((d) => ({ ...d, [p.id]: e.target.value.replace(/[^0-9,.]/g, "") }))}
                    onFocus={(e) => {
                      e.currentTarget.select();
                      setQtyDrafts((d) => ({ ...d, [p.id]: p.unit === "kg" ? brl(qty) : String(qty) }));
                    }}
                    onBlur={(e) => {
                      const raw = e.currentTarget.value.replace(",", ".");
                      const value = Number(raw);
                      if (Number.isFinite(value)) actions.setCartQty(p.id, value);
                      setQtyDrafts((d) => { const next = { ...d }; delete next[p.id]; return next; });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    inputMode="decimal"
                    aria-label={`Quantidade de ${p.name}`}
                    className="w-14 bg-transparent text-center font-mono text-[13px] text-foreground outline-none"
                  />
                  <span className="font-mono text-[11px] text-muted-foreground">{p.unit === "kg" ? "kg" : "un"}</span>
                  <button type="button" onClick={() => actions.addToCart(p.id, p.unit === "kg" ? 0.1 : 1)} className="h-6 w-6 rounded-md grid place-items-center text-subtle hover:bg-accent">+</button>
                </div>
                <button onClick={() => actions.removeFromCart(p.id)} className="text-muted-foreground hover:text-destructive text-sm" aria-label="Remover">×</button>
              </div>
            ))}
          </div>
          <div className="pt-3 border-t border-border">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Cliente (opcional)" className="field text-[13px] text-foreground" />
              <input value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} inputMode="numeric" placeholder="CPF (opcional)" className="field font-mono text-[13px] text-foreground" />
            </div>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex rounded-lg bg-secondary ring-1 ring-border p-1 shrink-0">
                <button type="button" onClick={() => setDiscountType("R$")} className={`rounded-md px-3 py-1.5 text-[11px] font-bold transition-colors ${discountType === "R$" ? "bg-primary text-primary-foreground" : "text-secondary-foreground"}`}>R$</button>
                <button type="button" onClick={() => setDiscountType("%")} className={`rounded-md px-3 py-1.5 text-[11px] font-bold transition-colors ${discountType === "%" ? "bg-primary text-primary-foreground" : "text-secondary-foreground"}`}>%</button>
              </div>
              <input value={discountInput} onChange={(e) => setDiscountInput(e.target.value.replace(/[^0-9,\.]/g, ""))} inputMode="decimal" placeholder={discountType === "R$" ? "Desconto em R$" : "Desconto em %"} className="field flex-1 font-mono text-[13px] text-foreground" />
              {discount > 0 && <span className="font-mono text-[11px] text-destructive whitespace-nowrap">- R$ {brl(discount)}</span>}
            </div>
            <div className="flex justify-between items-baseline">
              <span className="label-mono">{discount > 0 ? "Total com desconto" : "Total"}</span>
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
            <p className="font-mono text-[12px] text-muted-foreground">{done.payment} · {done.items.length} itens{done.customer ? ` · ${done.customer}` : ""}</p>
            <p className="mt-3 font-display text-5xl text-primary">R$ {brl(done.total)}</p>
            {done.received && done.received > done.total && (
              <p className="mt-2 font-mono text-sm text-foreground">Troco: R$ {brl(done.received - done.total)}</p>
            )}
            <button onClick={() => printReceipt(done)} className="mt-5 w-full rounded-xl bg-secondary ring-1 ring-border text-secondary-foreground font-semibold py-3 hover:text-foreground">
              🧾 Gerar comprovante
            </button>
            <button autoFocus onClick={() => setDone(null)} className="mt-2 w-full rounded-xl bg-primary text-primary-foreground font-bold py-3">
              Nova venda <kbd className="font-mono text-[11px] opacity-70">ESC</kbd>
            </button>
          </div>
        </div>
      )}
      {cam && <CameraScanner title="Bipar produtos" onCode={scanAdd} onClose={() => setCam(false)} />}
      {pendingWeight && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-background/70 backdrop-blur-sm p-4" onClick={() => setPendingWeight(null)}>
          <div className="mfb-in w-full max-w-sm rounded-2xl bg-popover ring-1 ring-primary/40 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="label-mono">PESAGEM</div>
            <h2 className="mt-1 font-display text-2xl tracking-[.08em] text-heading">{pendingWeight.name}</h2>
            <div className="mt-4 rounded-xl bg-well ring-1 ring-border p-4 text-center">
              <div className="font-display text-4xl text-heading">{weightDisplay}</div>
              <input
                autoFocus
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmWeight();
                  if (e.key === "Escape") setPendingWeight(null);
                }}
                inputMode="numeric"
                aria-label="Peso em gramas"
                className="mt-3 w-full rounded-lg bg-background px-3 py-2 text-center font-mono text-sm text-foreground outline-none ring-1 ring-border focus:ring-primary"
              />
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">Digite os gramas no teclado ou use os números abaixo</div>
              <div className="mt-1 font-mono text-[12px] text-muted-foreground">R$ {brl(pendingWeight.price)}/kg · estoque {brl(pendingWeight.stock)} kg</div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              {["1","2","3","4","5","6","7","8","9"].map((digit) => (
                <button key={digit} onClick={() => addWeightDigit(digit)} className="rounded-xl bg-secondary ring-1 ring-border py-3.5 text-lg font-bold text-foreground hover:bg-accent">{digit}</button>
              ))}
              <button onClick={() => setWeightInput("0")} className="rounded-xl bg-secondary ring-1 ring-border py-3.5 text-lg font-bold text-secondary-foreground">C</button>
              <button onClick={() => addWeightDigit("0")} className="rounded-xl bg-secondary ring-1 ring-border py-3.5 text-lg font-bold text-foreground hover:bg-accent">0</button>
              <button onClick={removeWeightDigit} className="rounded-xl bg-secondary ring-1 ring-border py-3.5 text-lg font-bold text-secondary-foreground">⌫</button>
            </div>
            <p className="mt-3 text-center font-mono text-[10px] text-muted-foreground">Digite em gramas: 5 = 5g · 500 = 500g · 1250 = 1kg 250g</p>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setPendingWeight(null)} className="flex-1 rounded-xl bg-secondary ring-1 ring-border py-3 font-semibold text-secondary-foreground">Cancelar</button>
              <button onClick={confirmWeight} disabled={weightKg <= 0} className="flex-1 rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-40">Adicionar</button>
            </div>
          </div>
        </div>
      )}
      {editing !== undefined && <ProductForm product={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
