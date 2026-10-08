import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, useStore } from "@/lib/store";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({ meta: [{ title: "MobFlow — Configurações" }] }),
  component: Configuracoes,
});

function Configuracoes() {
  const navigate = useNavigate();
  const settings = useStore((s) => s.settings);
  const [name, setName] = useState(settings.companyName);
  const [logo, setLogo] = useState(settings.companyLogo ?? "");
  const [saved, setSaved] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetError, setResetError] = useState("");

  useEffect(() => {
    if (sessionStorage.getItem("mobflow-management") !== "1") navigate({ to: "/gerencia" });
  }, [navigate]);

  useEffect(() => {
    setName(settings.companyName);
    setLogo(settings.companyLogo ?? "");
  }, [settings]);

  const chooseLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("A logo deve ter no máximo 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = () => {
    actions.updateSettings({ companyName: name.trim(), companyLogo: logo || undefined });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const openReset = () => {
    setResetError("");
    setResetOpen(true);
  };

  const reset = () => {
    const ok = confirm("Esta alteração não pode ser desfeita, você tem certeza?");
    if (!ok) return;

    actions.resetAppData();
    setResetOpen(false);
    setResetError("");
    alert("Dados zerados. A conta e as configurações da empresa foram mantidas.");
  };

  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="max-w-3xl mx-auto space-y-5">
        <section className="glass p-5 md:p-6">
          <div className="flex items-center justify-between gap-3 mb-6">
            <div>
              <h1 className="font-display text-2xl tracking-[.1em] text-heading">CONFIGURAÇÕES</h1>
              <p className="text-sm text-muted-foreground mt-1">Personalize a identificação da sua empresa no PDV.</p>
            </div>
            <button onClick={() => navigate({ to: "/gerencia" })} className="rounded-xl bg-secondary px-4 py-2.5 text-sm text-secondary-foreground hover:bg-accent">← Voltar</button>
          </div>

          <div className="rounded-2xl border border-sky-100 bg-sky-50/30 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-heading">Usuários do PDV</h2>
                <p className="mt-1 text-sm text-muted-foreground">Crie e gerencie os usuários que terão acesso somente ao ponto de venda.</p>
              </div>
              <button onClick={() => navigate({ to: "/usuarios" })} className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Gerenciar</button>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 p-5">
            <h2 className="font-semibold text-heading">Identidade da empresa</h2>
            <div className="mt-5 grid md:grid-cols-[120px_1fr] gap-5 items-center">
              <div className="h-28 w-28 rounded-2xl bg-secondary ring-1 ring-border overflow-hidden grid place-items-center">
                {logo ? <img src={logo} alt="Logo da empresa" className="h-full w-full object-contain" /> : <span className="text-3xl text-muted-foreground">🏪</span>}
              </div>
              <div className="space-y-3">
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono">Nome da empresa</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da empresa" className="field text-sm text-foreground" />
                </label>
                <label className="block cursor-pointer">
                  <span className="label-mono">Logo da empresa</span>
                  <div className="mt-1.5 rounded-xl border border-dashed border-border px-3 py-3 text-sm text-secondary-foreground hover:bg-accent">Escolher imagem <span className="text-xs text-muted-foreground">(até 5 MB)</span></div>
                  <input type="file" accept="image/*" onChange={chooseLogo} className="hidden" />
                </label>
                {logo && <button type="button" onClick={() => setLogo("")} className="text-xs text-destructive hover:underline">Remover logo</button>}
              </div>
            </div>
            <button onClick={save} className="mt-5 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground hover:opacity-90">{saved ? "✓ Salvo" : "Salvar configurações"}</button>
          </div>
        </section>

        <section className="glass p-5 md:p-6 ring-1 ring-destructive/30">
          <h2 className="font-display text-xl tracking-[.08em] text-heading">ZERAR APLICAÇÃO</h2>
          <p className="mt-2 text-sm text-muted-foreground">Apaga produtos, vendas, estoque, conferências e recebimentos. Login, conta e configurações da empresa ficam preservados.</p>
          <button onClick={openReset} className="mt-4 rounded-xl bg-destructive px-5 py-3 font-semibold text-destructive-foreground hover:opacity-90">🗑️ Zerar tudo e começar do zero</button>
          {resetOpen && (
            <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
              <div className="w-full max-w-md glass p-6 shadow-2xl">
                <div className="text-2xl">⚠️</div>
                <h3 className="mt-2 font-display text-xl tracking-[.08em] text-heading">CONFIRMAÇÃO DE GERÊNCIA</h3>
                <p className="mt-2 text-sm text-muted-foreground">Acesso autorizado pela conta de gerência. Confirme abaixo para apagar os dados.</p>
                {resetError && <p className="mt-2 text-sm text-destructive">{resetError}</p>}
                <div className="mt-5 flex gap-2">
                  <button onClick={() => setResetOpen(false)} className="flex-1 rounded-xl bg-secondary px-4 py-3 text-sm font-semibold text-secondary-foreground hover:bg-accent">Cancelar</button>
                  <button onClick={reset} className="flex-1 rounded-xl bg-destructive px-4 py-3 font-semibold text-destructive-foreground hover:opacity-90">Continuar</button>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
