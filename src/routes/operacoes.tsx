import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { ClipboardList, ClipboardCheck, PackageMinus, ArrowLeftRight, Scale, LockKeyhole, Users } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/operacoes")({
  head: () => ({ meta: [{ title: "MobFlow — Operações" }] }),
  component: Operacoes,
});

function Operacoes() {
  const navigate = useNavigate();
  const [hasManagementAccess, setHasManagementAccess] = useState(false);
  useEffect(() => {
    const readPermissions = () => {
      try {
        const permissions = JSON.parse(sessionStorage.getItem("mobflow-permissions") || "[]") as string[];
        setHasManagementAccess(permissions.includes("Gerência"));
      } catch { setHasManagementAccess(false); }
    };
    readPermissions();
    window.addEventListener("mobflow-pdv-auth-changed", readPermissions);
    return () => window.removeEventListener("mobflow-pdv-auth-changed", readPermissions);
  }, []);
  const items = [
    { title: "Conferência", description: "Conferir os produtos recebidos e as notas pendentes.", icon: ClipboardCheck, ready: true },
    { title: "Baixa de produtos", description: "Registrar saídas, perdas ou produtos danificados.", icon: PackageMinus, ready: true },
    { title: "Transferência", description: "Transferir quantidades entre locais ou estoques.", icon: ArrowLeftRight, ready: false },
    { title: "Balanço de estoque", description: "Conferir quantidades e ajustar o saldo dos produtos.", icon: Scale, ready: true },\n    { title: "Fornecedores e Clientes", description: "Cadastre e consulte fornecedores e clientes para reutilizar seus dados nas operações.", icon: Users, ready: true },
  ];
  return (
    <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
      <AppHeader />
      <main className="mx-auto max-w-5xl space-y-6 pt-16">
        <section className="rounded-2xl bg-white p-5 ring-1 ring-border md:p-7">
          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <div className="flex items-center justify-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-green-600/10 text-green-700"><ClipboardList className="h-6 w-6" /></div>
              <h1 className="font-display text-3xl font-extrabold text-heading md:text-4xl">OPERAÇÕES</h1>
            </div>
          </div>
        </section>
        {hasManagementAccess && <div className="flex justify-center"><button type="button" onClick={() => navigate({ to: "/gerencia" })} className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-green-800"><LockKeyhole className="h-4 w-4" /> Voltar para Gerência</button></div>}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.title} type="button" onClick={() => item.title === "Conferência" ? navigate({ to: "/conferencia" }) : item.title === "Baixa de produtos" ? navigate({ to: "/baixa-produtos" }) : item.title === "Balanço de estoque" ? navigate({ to: "/balanco-estoque" }) : item.title === "Fornecedores e Clientes" ? navigate({ to: "/fornecedores-clientes" }) : window.alert(item.title + " será configurada na próxima etapa.")} className="rounded-2xl bg-white p-5 text-left ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-primary/50">
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
