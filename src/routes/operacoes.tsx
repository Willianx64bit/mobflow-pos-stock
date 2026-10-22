import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { ArrowLeft, ClipboardList, PackageMinus, ArrowLeftRight, Scale } from "lucide-react";

export const Route = createFileRoute("/operacoes")({
  head: () => ({ meta: [{ title: "MobFlow — Operações" }] }),
  component: Operacoes,
});

function Operacoes() {
  const navigate = useNavigate();
  const items = [
    { title: "Baixa de produtos", description: "Registrar saídas, perdas ou produtos danificados.", icon: PackageMinus, ready: false },
    { title: "Transferência", description: "Transferir quantidades entre locais ou estoques.", icon: ArrowLeftRight, ready: false },
    { title: "Balanço de estoque", description: "Conferir quantidades e ajustar o saldo dos produtos.", icon: Scale, ready: true },
  ];
  return (
    <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
      <AppHeader />
      <main className="mx-auto max-w-5xl space-y-6 pt-16">
        <button type="button" onClick={() => navigate({ to: "/gerencia" })} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-heading ring-1 ring-border hover:bg-accent">
          <ArrowLeft className="h-4 w-4" /> Voltar à Gerência
        </button>
        <section className="rounded-2xl bg-white p-5 ring-1 ring-border md:p-7">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-green-600/10 text-green-700"><ClipboardList className="h-6 w-6" /></div>
            <div>
              <h1 className="font-display text-2xl text-heading md:text-3xl">OPERAÇÕES</h1>
              <p className="mt-1 text-sm text-muted-foreground">Acesse as rotinas de movimentação e controle de estoque.</p>
            </div>
          </div>
        </section>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.title} type="button" onClick={() => item.ready ? navigate({ to: "/balanco-estoque" }) : window.alert(item.title + " será configurada na próxima etapa.")} className="rounded-2xl bg-white p-5 text-left ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-primary/50">
                <div className="flex items-center justify-between gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-xl bg-green-600/10 text-green-700"><Icon className="h-6 w-6" /></div>
                  {!item.ready && <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">Em preparação</span>}
                </div>
                <h2 className="mt-4 font-bold text-heading">{item.title}</h2>
                <p className="mt-2 text-sm leading-5 text-muted-foreground">{item.description}</p>
              </button>
            );
          })}
        </section>
      </main>
    </div>
  );
}
