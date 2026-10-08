import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { actions, useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";


async function callUsers(opts: { body: Record<string, unknown> }): Promise<{ data: any; error: unknown }> {
  try {
    const refreshed = await supabase.auth.refreshSession();
    let session = refreshed.data.session;
    if (!session) session = (await supabase.auth.getSession()).data.session;

    if (!session?.access_token) {
      sessionStorage.removeItem("mobflow-management");
      return { data: { error: "Sessão da gerência expirada. Entre novamente na gerência." }, error: true };
    }

    const requestBody = { ...opts.body };
    const { data, error } = await supabase.functions.invoke("mobflow-users", { ...opts, body: requestBody });
    if (!error) return { data, error: null };

    let errorBody: any = null;
    try { errorBody = await (error as { context?: Response }).context?.json(); } catch {}
    const raw = String(errorBody?.error ?? "");
    const friendly = raw.includes("Sessão inválida") || raw.includes("Sessão não encontrada")
      ? "Sessão da gerência expirada. Entre novamente na gerência."
      : raw.includes("Database error")
        ? "O banco recusou a criação do usuário. Verifique a configuração do banco e tente de novo."
        : raw;
    return { data: { error: friendly || undefined }, error: true };
  } catch {
    return { data: null, error: true };
  }
}

export const Route = createFileRoute("/configuracoes")({
  head: () => ({ meta: [{ title: "MobFlow — Configurações" }] }),
  component: Configuracoes,
});

function Configuracoes() {
  const navigate = useNavigate();
  const settings = useStore((s) => s.settings);
  const [name, setName] = useState(settings.companyName);
  const [logo, setLogo] = useState(settings.companyLogo ?? "");
  const [pixKey, setPixKey] = useState(settings.pixKey ?? "");
  const [pixKeyType, setPixKeyType] = useState<NonNullable<typeof settings.pixKeyType>>(settings.pixKeyType ?? "aleatoria");
  const [pixEditing, setPixEditing] = useState(false);
  const [pixChecking, setPixChecking] = useState(false);
  const [pixError, setPixError] = useState("");
  const [saved, setSaved] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetError, setResetError] = useState("");
  const [pdvUsers, setPdvUsers] = useState<Array<{ id: string; username: string; display_name?: string | null; active: boolean }>>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userName, setUserName] = useState("");
  const [userUsername, setUserUsername] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [userError, setUserError] = useState("");

  useEffect(() => {
    // A senha informada na tela de Gerência libera todas as opções administrativas
    // durante a sessão. Não pedir uma segunda senha ao entrar em Configurações.
    if (sessionStorage.getItem("mobflow-management") !== "1") {
      navigate({ to: "/gerencia" });
    }
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setUsersLoading(true);
      setUserError("");
      const { data, error } = await callUsers({ body: { action: "list" } });
      if (cancelled) return;
      if (error || !data?.users) setUserError(data?.error || "Não foi possível carregar os usuários.");
      else setPdvUsers(data.users);
      setUsersLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setName(settings.companyName);
    setLogo(settings.companyLogo ?? "");
    setPixKey(settings.pixKey ?? "");
    setPixKeyType(settings.pixKeyType ?? "aleatoria");
  }, [settings]);

  const loadPdvUsers = async () => {
    setUsersLoading(true);
    setUserError("");
    const { data, error } = await callUsers({ body: { action: "list" } });
    if (error || !data?.users) setUserError(data?.error || "Não foi possível carregar os usuários.");
    else setPdvUsers(data.users);
    setUsersLoading(false);
  };

  const createPdvUser = async () => {
    setUserError("");
    setUserMessage("");
    const { data, error } = await callUsers({
      body: { action: "create", displayName: userName, username: userUsername, password: userPassword },
    });
    if (error || !data?.ok) {
      setUserError(data?.error || "Não foi possível criar o usuário.");
      return;
    }
    setUserName("");
    setUserUsername("");
    setUserPassword("");
    setUserMessage("Usuário do PDV criado com sucesso.");
    await loadPdvUsers();
  };

  const togglePdvUser = async (user: (typeof pdvUsers)[number]) => {
    setUserError("");
    const { data, error } = await callUsers({
      body: { action: "toggle", userId: user.id, active: !user.active },
    });
    if (error || !data?.ok) setUserError(data?.error || "Não foi possível alterar o acesso.");
    else await loadPdvUsers();
  };

  const resetPdvPassword = async (user: (typeof pdvUsers)[number]) => {
    const next = window.prompt(`Nova senha para ${user.username} (mínimo 6 caracteres):`);
    if (!next) return;
    setUserError("");
    const { data, error } = await callUsers({
      body: { action: "reset_password", userId: user.id, password: next },
    });
    if (error || !data?.ok) setUserError(data?.error || "Não foi possível trocar a senha.");
    else setUserMessage("Senha alterada.");
  };

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
    actions.updateSettings({ companyName: name.trim(), companyLogo: logo || undefined, pixKey: pixKey.trim() || undefined, pixKeyType });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const unlockPixEditing = async () => {
    setPixError("");
    setPixChecking(true);
    const { data, error } = await callUsers({ body: { action: "list" } });
    setPixChecking(false);
    if (error || !data?.users) {
      setPixError(data?.error || "Acesso de gerência necessário.");
      return;
    }
    setPixEditing(true);
    setPixError("");
  };

  const cancelPixEditing = () => {
    setPixEditing(false);
    setPixError("");
    setPixKey(settings.pixKey ?? "");
    setPixKeyType(settings.pixKeyType ?? "aleatoria");
  };

  const savePix = () => {
    actions.updateSettings({ pixKey: pixKey.trim() || undefined, pixKeyType });
    setPixEditing(false);
    setPixError("");
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
              <button onClick={() => void loadPdvUsers()} className="rounded-xl bg-secondary px-3 py-2 text-sm text-secondary-foreground">Atualizar</button>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-2">
              <input value={userName} onChange={e => setUserName(e.target.value)} placeholder="Nome do operador" className="field text-sm text-foreground" />
              <input value={userUsername} onChange={e => setUserUsername(e.target.value.toUpperCase())} placeholder="Usuário" className="field text-sm text-foreground" />
              <input value={userPassword} onChange={e => setUserPassword(e.target.value)} type="password" placeholder="Senha (mín. 6)" className="field text-sm text-foreground" />
            </div>
            {userError && <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{userError}</div>}
            {userMessage && <div className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{userMessage}</div>}
            <button onClick={() => void createPdvUser()} disabled={userUsername.trim().length < 3 || userPassword.length < 6} className="mt-3 w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-40">Criar usuário do PDV</button>
            <div className="mt-5 border-t border-border/50 pt-4">
              {usersLoading ? <div className="py-4 text-center text-sm text-muted-foreground">Carregando usuários...</div> : pdvUsers.length === 0 ? <div className="py-4 text-center text-sm text-muted-foreground">Nenhum usuário de PDV cadastrado.</div> : pdvUsers.map(user => (
                <div key={user.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 py-3 last:border-0">
                  <div className="flex-1 min-w-40"><div className="font-semibold text-foreground">{user.display_name || user.username}</div><div className="font-mono text-[11px] text-muted-foreground">@{user.username}</div></div>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold">{user.active ? "Ativo" : "Desativado"}</span>
                  <button onClick={() => void resetPdvPassword(user)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground">Trocar senha</button>
                  <button onClick={() => void togglePdvUser(user)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground">{user.active ? "Desativar" : "Ativar"}</button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-heading">Pagamento Pix</h2>
                <p className="mt-1 text-sm text-muted-foreground">Cadastre a chave Pix que será usada para gerar QR Codes com o valor automático no PDV.</p>
              </div>
              {!pixEditing && (
                <button onClick={() => void unlockPixEditing()} className="rounded-xl bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground ring-1 ring-border" type="button">
                  🔒 Alterar chave
                </button>
              )}
            </div>

            {!pixEditing ? (
              <div className="mt-4 rounded-xl bg-well ring-1 ring-border p-4">
                <div className="label-mono">CHAVE PIX CADASTRADA</div>
                <div className="mt-1 font-mono text-sm text-foreground break-all">{pixKey || "Nenhuma chave cadastrada"}</div>
                <div className="mt-1 text-xs text-muted-foreground">A alteração é liberada somente após nova validação do acesso de gerência.</div>
              </div>
            ) : (
              <>
                <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr]">
                  <label className="flex flex-col gap-1.5">
                    <span className="label-mono">Tipo da chave</span>
                    <select value={pixKeyType} onChange={(e) => setPixKeyType(e.target.value as NonNullable<typeof settings.pixKeyType>)} className="field text-sm text-foreground">
                      <option value="telefone">Telefone</option>
                      <option value="cpf">CPF</option>
                      <option value="cnpj">CNPJ</option>
                      <option value="email">E-mail</option>
                      <option value="aleatoria">Aleatória</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="label-mono">Chave Pix</span>
                    <input value={pixKey} onChange={(e) => setPixKey(e.target.value)} placeholder="Ex.: 11999999999" className="field text-sm text-foreground" />
                  </label>
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={cancelPixEditing} className="flex-1 rounded-xl bg-secondary py-3 font-semibold text-secondary-foreground ring-1 ring-border">Cancelar</button>
                  <button type="button" onClick={savePix} className="flex-1 rounded-xl bg-primary py-3 font-bold text-primary-foreground">Salvar chave Pix</button>
                </div>
              </>
            )}

            <div className="mt-3 rounded-xl bg-primary/5 ring-1 ring-primary/15 px-3 py-2 text-xs text-muted-foreground">
              O QR Code será gerado no checkout com o valor exato da venda. O MobFlow não confirma o pagamento automaticamente nesta versão.
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
