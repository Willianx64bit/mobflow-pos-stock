import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, CalendarClock, ClipboardCheck, Package, ShoppingCart, UsersRound, Wallet } from "lucide-react";

export const Route = createFileRoute("/saiba-mais")({
  head: () => ({
    meta: [
      { title: "Conheça o MobFlow | PDV, estoque e gestão" },
      { name: "description", content: "Conheça o MobFlow: ponto de venda, controle de estoque, conferência, validade, fiado e gestão em um só sistema." },
      { property: "og:title", content: "Conheça o MobFlow | PDV e estoque" },
      { property: "og:description", content: "Veja como o MobFlow ajuda a organizar as vendas e o estoque da sua empresa." },
    ],
  }),
  component: SaibaMais,
});

const features = [
  { icon: ShoppingCart, title: "PDV e checkout", text: "Registre vendas, encontre produtos e acompanhe o total do carrinho em uma tela prática." },
  { icon: Package, title: "Estoque e produtos", text: "Cadastre produtos, preços, códigos de barras, quantidades e informações de estoque." },
  { icon: ClipboardCheck, title: "Conferência", text: "Confira mercadorias e acompanhe divergências para ajudar a manter os registros organizados." },
  { icon: CalendarClock, title: "Controle de validade", text: "Organize datas de vencimento e identifique produtos que precisam de atenção." },
  { icon: Wallet, title: "Fiado e recebimentos", text: "Registre vendas fiadas e acompanhe pagamentos e recebimentos." },
  { icon: BarChart3, title: "Gerência", text: "Acesse ferramentas de gestão e configurações conforme as permissões da sua conta." },
];

function PreviewWindow({ kind }: { kind: "pdv" | "estoque" | "gerencia" }) {
  const isPdv = kind === "pdv";
  const isStock = kind === "estoque";
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl">
      <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="ml-2 truncate text-[10px] font-medium text-slate-500">MobFlow · {isPdv ? "PDV / Checkout" : isStock ? "Estoque / Produtos" : "Gerência"}</span>
      </div>
      <div className="grid grid-cols-[74px_1fr] sm:grid-cols-[100px_1fr]">
        <aside className="space-y-3 bg-slate-900 p-2.5 text-[9px] text-slate-300 sm:p-3">
          <div className="mb-4 text-sm font-black tracking-widest text-emerald-300">MOBFLOW</div>
          {["Visão geral", "PDV", "Estoque", "Conferência", "Validade", "Fiado", "Gerência"].map((item, i) => (
            <div key={item} className={((isPdv && i === 1) || (isStock && i === 2) || (!isPdv && !isStock && i === 6)) ? "rounded-md bg-emerald-400/20 px-1.5 py-1.5 text-emerald-200" : "px-1.5 py-1.5"}>{item}</div>
          ))}
        </aside>
        <div className="min-w-0 bg-slate-50 p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div><div className="text-[9px] uppercase tracking-wider text-slate-400">MobFlow PDV</div><div className="text-sm font-bold sm:text-base">{isPdv ? "Checkout de vendas" : isStock ? "Produtos e estoque" : "Painel de gerência"}</div></div>
            <div className="rounded-md bg-emerald-500 px-2 py-1 text-[9px] font-bold text-white">Sistema</div>
          </div>
          {isPdv ? (
            <div className="grid grid-cols-2 gap-2">
              {["Café", "Leite", "Arroz", "Açúcar"].map((name, i) => <div key={name} className="rounded-lg border border-slate-200 bg-white p-2"><div className="mb-2 grid h-10 place-items-center rounded bg-slate-100 text-base">{["☕","🥛","🍚","🛍️"][i]}</div><div className="text-[10px] font-semibold">{name}</div><div className="mt-1 text-[10px] font-bold text-emerald-700">R$ {(5.5 + i * 2.25).toFixed(2).replace(".", ",")}</div></div>)}
              <div className="col-span-2 rounded-lg bg-slate-900 p-3 text-white"><div className="text-[9px] text-slate-300">CHECKOUT · 3 itens</div><div className="mt-1 text-lg font-black">R$ 24,80</div><div className="mt-2 rounded-md bg-emerald-400 px-2 py-1.5 text-center text-[10px] font-bold text-slate-900">Finalizar venda</div></div>
            </div>
          ) : isStock ? (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="grid grid-cols-[1fr_auto_auto] gap-2 bg-slate-100 px-2 py-2 text-[9px] font-bold text-slate-500"><span>PRODUTO</span><span>QTD.</span><span>STATUS</span></div>
              {["Café tradicional", "Leite integral", "Arroz tipo 1", "Açúcar refinado"].map((name, i) => <div key={name} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-t border-slate-100 px-2 py-3 text-[9px]"><span className="truncate font-semibold">{name}</span><span>{[18, 7, 24, 3][i]}</span><span className={i === 3 ? "rounded bg-amber-100 px-1.5 py-1 text-amber-800" : "rounded bg-emerald-100 px-1.5 py-1 text-emerald-800"}>{i === 3 ? "Baixo" : "OK"}</span></div>)}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">{[["Vendas do dia","R$ 1.280,50"],["Produtos","248"]].map(([label,value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[9px] text-slate-500">{label}</div><div className="mt-1 text-base font-black text-slate-800">{value}</div></div>)}</div>
              <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="mb-3 text-[10px] font-bold">Resumo de movimentação</div><div className="flex h-20 items-end gap-2">{[38,58,44,75,54,90,67].map((height,i) => <div key={i} style={{height: height + "%"}} className="flex-1 rounded-t bg-emerald-400" />)}</div></div>
            </div>
          )}
          <div className="mt-3 text-center text-[8px] text-slate-400">Prévia ilustrativa da interface</div>
        </div>
      </div>
    </div>
  );
}

function SaibaMais() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <a href="/saiba-mais" className="text-xl font-black tracking-[.18em] text-emerald-300">MOBFLOW</a>
        <Link to="/" className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">Entrar</Link>
      </header>
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-8 sm:px-6 md:grid-cols-[1fr_.9fr] md:items-center md:pb-24 md:pt-14">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-200"><span className="h-2 w-2 rounded-full bg-emerald-300" /> Vendas e estoque em um só lugar</div>
          <h1 className="max-w-2xl text-4xl font-black leading-tight tracking-tight sm:text-5xl md:text-6xl">Mais organização para o dia a dia da sua empresa.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">O MobFlow reúne ponto de venda, controle de estoque e ferramentas de gestão para ajudar sua equipe a trabalhar com mais clareza.</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link to="/" className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 py-3.5 font-bold text-slate-950 transition hover:bg-emerald-200">Acessar MobFlow <ArrowLeft className="h-4 w-4 rotate-180" /></Link>
            <a href="#recursos" className="inline-flex items-center justify-center rounded-xl border border-white/20 px-5 py-3.5 font-semibold text-white transition hover:bg-white/10">Conhecer recursos</a>
          </div>
          <p className="mt-4 text-xs text-slate-400">A disponibilidade de cada recurso pode depender das permissões configuradas para a conta.</p>
        </div>
        <div className="relative mx-auto w-full max-w-xl">
          <div className="absolute -inset-4 rounded-3xl bg-emerald-400/10 blur-2xl" />
          <div className="relative"><PreviewWindow kind="pdv" /></div>
        </div>
      </section>
      <section className="overflow-hidden bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-bold uppercase tracking-[.18em] text-emerald-300">Veja uma venda acontecer</p>
            <h2 className="mt-3 text-3xl font-black sm:text-4xl">Do leitor ao checkout: simples assim.</h2>
            <p className="mt-4 leading-7 text-slate-300">Dê play e acompanhe uma demonstração animada do atendimento no caixa com o MobFlow.</p>
          </div>
          <div className="mx-auto mt-9 max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-slate-900 shadow-2xl shadow-emerald-950/40">
            <style>{`
              @keyframes mf-customer-enter { 0%,8% { transform: translateX(-90px); opacity:0 } 18%,82% { transform:translateX(0); opacity:1 } 94%,100% { transform:translateX(30px); opacity:0 } }
              @keyframes mf-product-scan { 0%,18% { transform:translateX(-50px) rotate(-8deg); opacity:0 } 28%,40% { transform:translateX(0) rotate(0); opacity:1 } 49%,100% { transform:translateX(95px) rotate(10deg); opacity:0 } }
              @keyframes mf-scanline { 0%,20% { transform:translateY(-16px); opacity:0 } 25% {opacity:1} 43% {transform:translateY(62px); opacity:1} 50%,100% {transform:translateY(62px);opacity:0} }
              @keyframes mf-total { 0%,43% { transform:scale(.94); opacity:.4 } 52%,100% { transform:scale(1); opacity:1 } }
              @keyframes mf-confirm { 0%,59% { transform:scale(.8); opacity:0 } 67%,92% { transform:scale(1); opacity:1 } 100% {transform:scale(.9);opacity:0} }
              @keyframes mf-check { 0%,68% {stroke-dashoffset:30;opacity:0} 78%,100% {stroke-dashoffset:0;opacity:1} }
              .mf-scene:not(.mf-playing) .mf-anim { animation-play-state:paused !important }
              .mf-playing .mf-customer { animation:mf-customer-enter 8s ease-in-out infinite }
              .mf-playing .mf-product { animation:mf-product-scan 8s ease-in-out infinite }
              .mf-playing .mf-scanline { animation:mf-scanline 8s ease-in-out infinite }
              .mf-playing .mf-total { animation:mf-total 8s ease-in-out infinite }
              .mf-playing .mf-confirm { animation:mf-confirm 8s ease-in-out infinite }
              .mf-playing .mf-check { stroke-dasharray:30; animation:mf-check 8s ease-out infinite }
              @media (prefers-reduced-motion: reduce) { .mf-anim { animation:none !important } }
            `}</style>
            <div className="mf-scene mf-playing relative min-h-[420px] overflow-hidden p-4 sm:min-h-[470px] sm:p-7">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(52,211,153,.14),transparent_55%)]" />
              <div className="relative flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-black tracking-[.2em] text-emerald-300"><span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-300 text-slate-950">M</span>MOBFLOW</div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-slate-300 sm:text-xs">DEMONSTRAÇÃO ANIMADA</div>
              </div>
              <div className="relative mt-5 grid gap-4 md:grid-cols-[.75fr_1.25fr] md:items-center">
                <div className="relative flex min-h-[170px] items-end justify-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-slate-800 to-slate-900 p-4">
                  <div className="absolute bottom-5 left-0 right-0 h-3 bg-slate-700" />
                  <div className="mf-anim mf-customer relative z-10 flex flex-col items-center">
                    <div className="h-12 w-12 rounded-full border-4 border-amber-100 bg-amber-200" />
                    <div className="relative -mt-1 h-20 w-20 rounded-t-[28px] bg-emerald-500"><div className="absolute left-2 top-5 h-7 w-3 rounded-full bg-emerald-300/70" /></div>
                  </div>
                  <div className="mf-anim mf-product absolute bottom-9 right-5 z-20 grid h-12 w-10 place-items-center rounded-md border border-amber-200 bg-amber-100 text-xl shadow-lg">🥫</div>
                  <div className="absolute bottom-3 left-3 rounded-lg bg-slate-950/80 px-2 py-1 text-[10px] font-semibold text-slate-200">1. Cliente chega ao caixa</div>
                </div>
                <div className="relative rounded-2xl border border-slate-700 bg-slate-800 p-3 sm:p-4">
                  <div className="flex items-center justify-between border-b border-slate-700 pb-3">
                    <div><div className="text-[9px] font-bold tracking-widest text-emerald-300">MOBFLOW PDV</div><div className="mt-1 text-sm font-bold text-white">PDV / CHECKOUT</div></div>
                    <div className="rounded-md bg-emerald-400/15 px-2 py-1 text-[10px] font-bold text-emerald-300">● Caixa aberto</div>
                  </div>
                  <div className="relative mt-3 overflow-hidden rounded-xl bg-white text-slate-800">
                    <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-100 p-3 text-xs"><div><div className="font-bold">Produto de demonstração</div><div className="mt-1 text-slate-500">Código lido pelo scanner</div></div><div className="text-right font-semibold">R$ 24,80</div></div>
                    <div className="mf-anim mf-scanline pointer-events-none absolute left-0 right-0 top-0 h-1 bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.9)]" />
                    <div className="mf-anim mf-total flex items-center justify-between bg-slate-50 p-3"><span className="text-xs font-semibold text-slate-500">TOTAL DA VENDA</span><span className="text-lg font-black text-slate-900">R$ 24,80</span></div>
                    <div className="p-3"><div className="rounded-lg bg-emerald-500 px-3 py-2.5 text-center text-xs font-black text-white">CONFIRMAR VENDA</div></div>
                  </div>
                  <div className="mf-anim mf-confirm absolute inset-0 z-20 grid place-items-center rounded-2xl bg-slate-950/95 p-4 text-center">
                    <div className="grid h-16 w-16 place-items-center rounded-full bg-emerald-400 text-slate-950"><svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path className="mf-check" d="m5 12 4 4L19 6" /></svg></div>
                    <div className="mt-3 text-xl font-black text-white">VENDA CONFIRMADA</div>
                    <div className="mt-1 text-sm text-emerald-300">Total: R$ 24,80</div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400"><span>2. Produto lido</span><span>3. Venda confirmada</span></div>
                </div>
              </div>
              <div className="relative mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <div><div className="text-xs font-bold text-white">Uma venda do início ao fim</div><div className="mt-1 text-[10px] text-slate-400">A animação reinicia automaticamente</div></div>
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-300 text-slate-950"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></div>
              </div>
            </div>
          </div>
          <p className="mx-auto mt-4 max-w-2xl text-center text-xs leading-5 text-slate-400">Esta é uma demonstração visual ilustrativa; os produtos, valores e etapas mostrados não representam uma venda real.</p>
        </div>
      </section>
      <section id="recursos" className="bg-white py-16 text-slate-900 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl"><p className="text-sm font-bold uppercase tracking-[.18em] text-emerald-700">Recursos</p><h2 className="mt-3 text-3xl font-black sm:text-4xl">Conheça o que você pode organizar com o MobFlow</h2><p className="mt-4 leading-7 text-slate-600">Ferramentas para acompanhar a operação sem perder de vista o que acontece no balcão e no estoque.</p></div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({icon: Icon,title,text}) => <article key={title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5"><div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-emerald-100 text-emerald-800"><Icon className="h-5 w-5" /></div><h3 className="text-lg font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{text}</p></article>)}
          </div>
        </div>
      </section>
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl"><p className="text-sm font-bold uppercase tracking-[.18em] text-emerald-300">Veja por dentro</p><h2 className="mt-3 text-3xl font-black sm:text-4xl">Uma visão das principais áreas</h2><p className="mt-4 leading-7 text-slate-300">Estas prévias ilustrativas mostram exemplos de como as áreas do sistema são organizadas.</p></div>
          <div className="mt-9 grid gap-6 lg:grid-cols-2">
            <div><PreviewWindow kind="estoque" /><h3 className="mt-4 text-lg font-bold">Produtos e estoque</h3><p className="mt-1 text-sm leading-6 text-slate-300">Visualize itens, quantidades e alertas de estoque.</p></div>
            <div><PreviewWindow kind="gerencia" /><h3 className="mt-4 text-lg font-bold">Painel de gerência</h3><p className="mt-1 text-sm leading-6 text-slate-300">Acompanhe informações de operação e acesso às ferramentas administrativas.</p></div>
          </div>
        </div>
      </section>
      <section className="bg-emerald-300 py-14 text-slate-950">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-5 px-4 sm:px-6 md:flex-row md:items-center">
          <div><h2 className="text-3xl font-black">Pronto para conhecer o MobFlow?</h2><p className="mt-2 text-slate-800">Entre na sua conta ou crie uma conta para sua empresa.</p></div>
          <Link to="/" className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-5 py-3.5 font-bold text-white transition hover:bg-slate-800">Entrar ou criar conta</Link>
        </div>
      </section>
      <footer className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-7 text-xs text-slate-400 sm:px-6 sm:flex-row sm:items-center sm:justify-between"><span>© {new Date().getFullYear()} MobFlow</span><a href="https://mobflow-pos-stock.vercel.app/" className="underline underline-offset-4">mobflow-pos-stock.vercel.app</a></footer>
    </main>
  );
}
