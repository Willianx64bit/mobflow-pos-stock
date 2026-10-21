import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BarChart3, CalendarClock, CheckCircle2, ClipboardCheck, Package, ShoppingCart, UsersRound, Wallet, ReceiptText, Settings2 } from "lucide-react";

export const Route = createFileRoute("/saiba-mais")({
  head: () => ({
    meta: [
      { title: "Conheça o MobFlow | PDV, estoque e gestão" },
      { name: "description", content: "Conheça os recursos do MobFlow: PDV, checkout, estoque, conferência, validade, fiado, recebimentos e gerência." },
      { property: "og:title", content: "Conheça o MobFlow | PDV e estoque" },
      { property: "og:description", content: "Veja como o MobFlow ajuda a organizar as vendas e o estoque da sua empresa." },
    ],
  }),
  component: SaibaMais,
});

type PreviewKind = "pdv" | "estoque" | "conferencia" | "validade" | "fiado" | "recebimentos" | "relatorios" | "gerencia" | "usuarios";

const screens: { kind: PreviewKind; eyebrow: string; title: string; description: string; icon: typeof ShoppingCart; points: string[] }[] = [
  { kind: "pdv", eyebrow: "01 · VENDAS", title: "Venda rápida no PDV", description: "Encontre os produtos e registre as compras em uma tela direta, feita para a rotina do caixa.", icon: ShoppingCart, points: ["Busca de produtos", "Preços e quantidades", "Fluxo de venda organizado"] },
  { kind: "estoque", eyebrow: "02 · PRODUTOS", title: "Estoque sempre organizado", description: "Tenha uma visão prática dos produtos cadastrados e acompanhe quantidades disponíveis.", icon: Package, points: ["Cadastro de produtos", "Quantidade em estoque", "Identificação de itens baixos"] },
  { kind: "conferencia", eyebrow: "03 · CONFERÊNCIA", title: "Confira e compare", description: "Organize a conferência de mercadorias e facilite a identificação de possíveis diferenças.", icon: ClipboardCheck, points: ["Registro de conferência", "Comparação de quantidades", "Acompanhamento de divergências"] },
  { kind: "validade", eyebrow: "04 · VALIDADE", title: "Atenção aos vencimentos", description: "Consulte as datas de validade cadastradas e saiba quais produtos merecem atenção.", icon: CalendarClock, points: ["Datas organizadas", "Identificação por vencimento", "Acompanhamento mais simples"] },
  { kind: "fiado", eyebrow: "05 · FIADO", title: "Contas de clientes em ordem", description: "Consulte registros de vendas fiadas e acompanhe os valores em aberto com mais clareza.", icon: Wallet, points: ["Registros por cliente", "Valores pendentes", "Consulta de movimentações"] },
  { kind: "recebimentos", eyebrow: "06 · RECEBIMENTOS", title: "Acompanhe os recebimentos", description: "Mantenha os registros de pagamentos e recebimentos mais fáceis de consultar.", icon: ReceiptText, points: ["Histórico de recebimentos", "Consulta de registros", "Informações reunidas"] },
  { kind: "relatorios", eyebrow: "07 · RESUMOS", title: "Entenda a movimentação", description: "Consulte informações da operação e acompanhe os dados disponíveis para sua conta.", icon: BarChart3, points: ["Resumo de vendas", "Histórico de movimentações", "Visão geral da operação"] },
  { kind: "gerencia", eyebrow: "08 · GERÊNCIA", title: "Mais visão da operação", description: "Reúna ferramentas de acompanhamento e administração em uma área própria para gerência.", icon: Settings2, points: ["Acesso às ferramentas de gestão", "Indicadores e resumos", "Configurações disponíveis"] },
  { kind: "usuarios", eyebrow: "09 · ACESSOS", title: "Cada pessoa com sua função", description: "Organize os usuários e as permissões de acesso conforme a função de cada integrante da equipe.", icon: UsersRound, points: ["Cadastro de usuários", "Permissões por função", "Acesso mais organizado"] },
];

function MiniScreen({ kind }: { kind: PreviewKind }) {
  const titles: Record<PreviewKind, string> = { pdv: "PDV · Checkout", estoque: "Produtos e estoque", conferencia: "Conferência", validade: "Controle de validade", fiado: "Contas de clientes", recebimentos: "Recebimentos", relatorios: "Resumo da operação", gerencia: "Painel de gerência", usuarios: "Usuários e permissões" };
  const rows: Record<PreviewKind, [string, string, string][]> = {
    pdv: [["Café tradicional", "2 un.", "R$ 18,00"], ["Leite integral", "1 un.", "R$ 5,50"], ["Arroz tipo 1", "1 un.", "R$ 8,90"]],
    estoque: [["Café tradicional", "18 un.", "Disponível"], ["Leite integral", "7 un.", "Disponível"], ["Açúcar refinado", "3 un.", "Estoque baixo"]],
    conferencia: [["Café tradicional", "20 / 20", "Conferido"], ["Leite integral", "8 / 7", "Divergência"], ["Arroz tipo 1", "12 / 12", "Conferido"]],
    validade: [["Iogurte natural", "22/10/2026", "Atenção"], ["Leite integral", "28/10/2026", "Próximo"], ["Biscoito", "15/12/2026", "Em dia"]],
    fiado: [["Maria Oliveira", "R$ 42,50", "Em aberto"], ["João Santos", "R$ 18,00", "Em aberto"], ["Ana Lima", "R$ 0,00", "Quitado"]],
    recebimentos: [["Venda #1048", "R$ 52,90", "Recebido"], ["Venda #1047", "R$ 18,00", "Recebido"], ["Conta cliente", "R$ 30,00", "Registrado"]],
    relatorios: [["Vendas do dia", "R$ 1.280,50", "Resumo"], ["Itens vendidos", "86", "Quantidade"], ["Movimentações", "42", "Registros"]],
    gerencia: [["Vendas", "Resumo diário", "Consultar"], ["Estoque", "Produtos", "Consultar"], ["Operação", "Movimentações", "Consultar"]],
    usuarios: [["Operador caixa", "PDV", "Ativo"], ["Conferente", "Conferência", "Ativo"], ["Gerente", "Gerência", "Ativo"]],
  };
  const isPdv = kind === "pdv";
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#101a22] shadow-[0_25px_70px_-28px_rgba(16,185,129,.35)] transition duration-500 hover:-translate-y-1 hover:border-emerald-300/40">
      <div className="flex items-center gap-2 border-b border-white/10 bg-[#0b1218] px-4 py-3">
        <div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-400/80"/><span className="h-2.5 w-2.5 rounded-full bg-amber-300/80"/><span className="h-2.5 w-2.5 rounded-full bg-emerald-300/80"/></div>
        <span className="ml-2 text-xs font-medium text-slate-400">MOBFLOW <span className="text-slate-600">/</span> {titles[kind]}</span>
        <span className="ml-auto rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[9px] font-bold text-emerald-200">PAINEL</span>
      </div>
      <div className="grid min-h-[260px] grid-cols-[76px_1fr] sm:grid-cols-[105px_1fr]">
        <aside className="border-r border-white/5 bg-[#0b1218] p-2.5 sm:p-3">
          <div className="mb-5 text-[10px] font-black tracking-[.18em] text-emerald-300 sm:text-xs">MOBFLOW</div>
          {["Visão geral", "PDV", "Estoque", "Conferência", "Validade", "Fiado", "Gerência"].map((label) => <div key={label} className={((kind === "pdv" && label === "PDV") || (kind === "estoque" && label === "Estoque") || (kind === "conferencia" && label === "Conferência") || (kind === "validade" && label === "Validade") || (kind === "fiado" && label === "Fiado") || (["gerencia","relatorios","recebimentos","usuarios"].includes(kind) && label === "Gerência")) ? "mb-1 rounded-md bg-emerald-300/10 px-1.5 py-2 text-[9px] font-semibold text-emerald-200 sm:px-2 sm:text-[10px]" : "mb-1 px-1.5 py-2 text-[9px] text-slate-500 sm:px-2 sm:text-[10px]"}>{label}</div>)}
        </aside>
        <div className="min-w-0 p-3 sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-2"><div><p className="text-[9px] uppercase tracking-[.15em] text-slate-500">Área de trabalho</p><h3 className="mt-1 text-sm font-bold text-white sm:text-lg">{titles[kind]}</h3></div><div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[9px] text-slate-400">Conta ativa</div></div>
          {isPdv && <div className="mb-3 grid grid-cols-3 gap-2">{[["Produtos","Buscar item"],["Quantidade","1 unidade"],["Pagamento","Selecionar"]].map(([a,b])=><div key={a} className="rounded-lg border border-white/10 bg-white/[.03] p-2"><p className="text-[9px] text-slate-500">{a}</p><p className="mt-1 truncate text-[10px] font-semibold text-slate-200">{b}</p></div>)}</div>}
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b1218]">
            <div className="grid grid-cols-[1fr_auto] gap-2 border-b border-white/10 px-2.5 py-2 text-[9px] font-bold uppercase tracking-wide text-slate-500 sm:grid-cols-[1fr_auto_auto] sm:px-3"><span>Descrição</span><span>Detalhes</span><span className="hidden sm:block">Status</span></div>
            {rows[kind].map(([name,value,status],i)=><div key={name} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-white/5 px-2.5 py-3 last:border-0 sm:grid-cols-[1fr_auto_auto] sm:px-3"><span className="truncate text-[9px] font-medium text-slate-200 sm:text-[10px]">{name}</span><span className="text-[9px] text-slate-300 sm:text-[10px]">{value}</span><span className={`hidden rounded-md px-2 py-1 text-[9px] sm:block ${status.includes("baixo") || status.includes("Divergência") || status.includes("Atenção") || status.includes("aberto") ? "bg-amber-300/10 text-amber-200" : "bg-emerald-300/10 text-emerald-200"}`}>{status}</span></div>)}
          </div>
          {isPdv ? <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-300 px-3 py-3 text-slate-950"><div><p className="text-[9px] font-semibold uppercase">Total do carrinho</p><p className="text-lg font-black">R$ 32,40</p></div><span className="rounded-lg bg-slate-950 px-3 py-2 text-[9px] font-bold text-white">Finalizar venda →</span></div> : <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-300/10 bg-emerald-300/[.05] px-3 py-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-300"/><span className="text-[9px] text-slate-400">Informações organizadas em um só lugar</span></div>}
        </div>
      </div>
    </div>
  );
}

function SaibaMais() {
  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-white">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
        <a href="/saiba-mais" className="text-xl font-black tracking-[.18em] text-emerald-300">MOBFLOW</a>
        <Link to="/" className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-emerald-300/50 hover:bg-white/5">Entrar</Link>
      </header>
      <section className="relative mx-auto grid max-w-7xl gap-10 px-4 pb-20 pt-8 sm:px-6 md:grid-cols-[.9fr_1.1fr] md:items-center md:pb-28 md:pt-12 lg:px-8">
        <div className="absolute -left-32 top-10 h-72 w-72 rounded-full bg-emerald-400/10 blur-[100px]"/>
        <div className="relative z-10">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold text-emerald-200"><span className="h-2 w-2 rounded-full bg-emerald-300"/> Vendas, estoque e gestão</div>
          <h1 className="max-w-2xl text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl md:text-6xl">Sua operação mais organizada. <span className="text-emerald-300">Tudo flui.</span></h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">Conheça as áreas do MobFlow e veja como reunir as tarefas do dia a dia da sua empresa em um só sistema.</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row"><Link to="/" className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 py-3.5 font-bold text-slate-950 transition hover:bg-emerald-200">Acessar MobFlow <ArrowRight className="h-4 w-4"/></Link><a href="#telas" className="inline-flex items-center justify-center rounded-xl border border-white/20 px-5 py-3.5 font-semibold text-white transition hover:bg-white/5">Explorar as telas</a></div>
          <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300"/> PDV e checkout</span><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300"/> Controle de estoque</span><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300"/> Ferramentas de gestão</span></div>
        </div>
        <div className="relative"><div className="absolute -inset-4 rounded-3xl bg-emerald-400/10 blur-3xl"/><div className="relative rotate-[.5deg]"><MiniScreen kind="pdv"/></div><p className="mt-3 text-center text-xs text-slate-500">Prévia ilustrativa criada para apresentar os recursos do sistema.</p></div>
      </section>
      <section className="border-y border-white/5 bg-[#0b1218] py-12">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:grid-cols-3 sm:px-6 lg:px-8">{[{value:"PDV",label:"Venda e checkout"},{value:"Estoque",label:"Produtos e quantidades"},{value:"Gestão",label:"Acompanhamento da operação"}].map(({value,label})=><div key={value} className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><p className="text-xl font-black text-emerald-300">{value}</p><p className="mt-1 text-sm text-slate-400">{label}</p></div>)}</div>
      </section>
      <section id="telas" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="max-w-2xl"><p className="text-sm font-bold uppercase tracking-[.2em] text-emerald-300">Conheça por dentro</p><h2 className="mt-3 text-3xl font-black sm:text-4xl md:text-5xl">Cada área tem seu lugar.</h2><p className="mt-4 text-base leading-7 text-slate-300">Explore as principais funções do MobFlow. Cada apresentação tem uma explicação logo abaixo, para você entender o que cada área ajuda a organizar.</p></div>
        <div className="mt-10 grid gap-10 md:grid-cols-2 md:gap-x-7 md:gap-y-14 lg:gap-x-9">
          {screens.map(({kind,eyebrow,title,description,icon:Icon,points},index)=><article key={kind} className="group min-w-0 animate-in fade-in slide-in-from-bottom-3 duration-700"><MiniScreen kind={kind}/><div className="px-1 pb-1 pt-5"><div className="flex items-center gap-2 text-[11px] font-bold tracking-[.16em] text-emerald-300"><Icon className="h-4 w-4"/>{eyebrow}</div><h3 className="mt-2 text-xl font-bold sm:text-2xl">{title}</h3><p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">{description}</p><ul className="mt-4 grid gap-2 sm:grid-cols-2">{points.map(point=><li key={point} className="flex items-start gap-2 text-xs leading-5 text-slate-400"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300"/>{point}</li>)}</ul></div></article>)}
        </div>
      </section>
      <section className="border-y border-white/10 bg-gradient-to-r from-emerald-300 to-emerald-200 py-14 text-slate-950 sm:py-16"><div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-5 px-4 sm:px-6 md:flex-row md:items-center lg:px-8"><div><h2 className="text-3xl font-black sm:text-4xl">Pronto para conhecer o MobFlow?</h2><p className="mt-2 text-sm text-slate-800 sm:text-base">Entre na sua conta ou comece o cadastro da sua empresa.</p></div><Link to="/" className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3.5 font-bold text-white transition hover:bg-slate-800">Entrar ou criar conta <ArrowRight className="h-4 w-4"/></Link></div></section>
      <footer className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-7 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8"><span>© {new Date().getFullYear()} MobFlow</span><a href="https://mobflow-pos-stock.vercel.app/" className="underline underline-offset-4 hover:text-emerald-300">mobflow-pos-stock.vercel.app</a></footer>
    </main>
  );
}
