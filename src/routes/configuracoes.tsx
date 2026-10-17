import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, LockKeyhole, Trash2, AlertTriangle } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { actions, useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { verifyManagerPassword } from "@/lib/manager-auth";


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
      : raw.includes("Acesso de gerência")
        ? "Só a conta da gerência pode cadastrar usuários do PDV. Entre com o login da empresa."
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
  const [pixSectionOpen, setPixSectionOpen] = useState(false);
  const [companyIdentityOpen, setCompanyIdentityOpen] = useState(false);
  const [pixChecking, setPixChecking] = useState(false);
  const [pixError, setPixError] = useState("");
  const [saved, setSaved] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetSectionOpen, setResetSectionOpen] = useState(false);
  const [resetError, setResetError] = useState("");
  const [pdvUsers, setPdvUsers] = useState<Array<{ id: string; username: string; display_name?: string | null; active: boolean; permissions?: string[] }>>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userName, setUserName] = useState("");
  const [userUsername, setUserUsername] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [userError, setUserError] = useState("");
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [usersDetailsOpen, setUsersDetailsOpen] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const verifyManager = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          if (active) navigate({ to: "/gerencia" });
          return;
        }
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("role,active")
          .eq("id", sessionData.session.user.id)
          .maybeSingle();

        const allowed = !error && profile?.active !== false && profile?.role === "manager" && sessionStorage.getItem("mobflow-management") === "1";
        if (!active) return;
        if (!allowed) {
          sessionStorage.removeItem("mobflow-management");
          navigate({ to: "/gerencia" });
          return;
        }
        // Só busca usuários depois de confirmar que a conta é da gerência
        setUsersLoading(true);
        setUserError("");
        const { data, error: usersError } = await callUsers({ body: { action: "list" } });
        if (!active) return;
        if (usersError || !data?.users) setUserError(data?.error || "Não foi possível carregar os usuários.");
        else setPdvUsers(data.users);
        setUsersLoading(false);
      } catch {
        if (active) navigate({ to: "/gerencia" });
      }
    };
    void verifyManager();
    return () => { active = false; };
  }, [navigate]);

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
      body: { action: "create", displayName: userName, username: userUsername, password: userPassword, permissions: ["PDV", "Conferência"] },
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

  const saveUserPermissions = async (user: (typeof pdvUsers)[number], permissions: string[]) => {
    setUserError("");
    const { data, error } = await callUsers({ body: { action: "update_permissions", userId: user.id, permissions } });
    if (error || !data?.ok) setUserError(data?.error || "Não foi possível salvar as permissões.");
    else { setUserMessage(`Permissões de ${user.username} atualizadas.`); await loadPdvUsers(); }
  };

  const deletePdvUser = async (user: (typeof pdvUsers)[number]) => {
    const confirmed = window.confirm(`Tem certeza que deseja excluir o usuário "${user.username}"? Ele perderá o acesso ao PDV. Esta ação não pode ser desfeita.`);
    if (!confirmed) return;
    setUserError("");
    setUserMessage("");
    setDeletingUserId(user.id);
    const { data, error } = await callUsers({ body: { action: "delete", userId: user.id } });
    setDeletingUserId(null);
    if (error || !data?.ok) {
      setUserError(data?.error || "Não foi possível excluir o usuário.");
      return;
    }
    setUserMessage(`Usuário ${user.username} excluído com sucesso.`);
    await loadPdvUsers();
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
    const password = window.prompt("Digite a senha da gerência para alterar a chave Pix:");
    if (password === null) return;
    setPixChecking(true);
    const result = await verifyManagerPassword(password);
    setPixChecking(false);
    if (!result.ok) {
      setPixError(result.error || "Senha da gerência incorreta.");
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
    actions.updateSettings({ ...settings, pixKey: pixKey.trim() || undefined, pixKeyType });
    setPixEditing(false);
    setPixError("");
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const openReset = () => {
    setResetError("");
    setResetOpen(true);
  };

  const reset = async () => {
    setResetError("");
    const managerPassword = window.prompt("Digite somente a senha da gerência para confirmar e zerar a aplicação:");
    if (managerPassword === null) return;
    if (!managerPassword.trim()) {
      setResetError("Informe a senha da gerência para continuar.");
      return;
    }

    setPixChecking(true);
    const passwordCheck = await verifyManagerPassword(managerPassword);
    setPixChecking(false);
    if (!passwordCheck.ok) {
      setResetError(passwordCheck.error || "Senha da gerência incorreta.");
      return;
    }

    const ok = confirm("Senha confirmada. Esta ação apagará os dados desta empresa e excluirá todos os usuários do PDV vinculados a ela. O login da gerência e as outras empresas não serão afetados. Deseja continuar?");
    if (!ok) return;

    const { data, error } = await callUsers({ body: { action: "delete_all_pdv" } });
    if (error || !data?.ok) {
      setResetError(data?.error || "Não foi possível excluir os usuários do PDV. Os dados da aplicação não foram zerados.");
      return;
    }

    actions.resetAppData();
    setName("");
    setLogo("");
    setPixKey("");
    setPixKeyType("aleatoria");
    setPixEditing(false);
    setSaved(false);
    setPdvUsers([]);
    setResetOpen(false);
    setResetError("");
    alert(`Aplicação zerada. Dados da empresa apagados e ${data.deleted ?? 0} usuário(s) do PDV excluído(s). O login da gerência foi mantido.`);
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-heading">Usuários do PDV</h2>
                <p className="mt-1 text-sm text-muted-foreground">Crie usuários e escolha quais áreas cada um pode acessar. A Gerência sempre exige a senha exclusiva.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const opening = !usersDetailsOpen;
                  setUsersDetailsOpen(opening);
                  if (opening) void loadPdvUsers();
                  else setAddUserOpen(false);
                }}
                className="rounded-xl bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground"
              >
                {usersDetailsOpen ? "Ocultar detalhes" : "Ver detalhes"}
              </button>
            </div>

            {usersDetailsOpen && (
              <div className="mt-4 border-t border-border/50 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-muted-foreground">
                    {pdvUsers.length} {pdvUsers.length === 1 ? "usuário cadastrado" : "usuários cadastrados"}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void loadPdvUsers()} className="rounded-xl bg-secondary px-3 py-2 text-sm text-secondary-foreground">Atualizar</button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddUserOpen((open) => !open);
                        setUserError("");
                        setUserMessage("");
                      }}
                      className="rounded-xl bg-primary px-3 py-2 text-sm font-bold text-primary-foreground"
                    >
                      {addUserOpen ? "Cancelar cadastro" : "+ Adicionar usuário"}
                    </button>
                  </div>
                </div>

                {addUserOpen && (
                  <div className="mt-4 rounded-xl border border-border/60 bg-white p-4">
                    <h3 className="mb-3 font-semibold text-heading">Novo usuário do PDV</h3>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      <input value={userName} onChange={e => setUserName(e.target.value)} placeholder="Nome do operador" className="field text-sm text-foreground" />
                      <input value={userUsername} onChange={e => setUserUsername(e.target.value.toUpperCase())} placeholder="Usuário" className="field text-sm text-foreground" />
                      <input value={userPassword} onChange={e => setUserPassword(e.target.value)} type="password" placeholder="Senha (mín. 6)" className="field text-sm text-foreground" />
                    </div>
                    <button type="button" onClick={() => void createPdvUser()} disabled={userUsername.trim().length < 3 || userPassword.length < 6} className="mt-3 w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-40">Criar usuário do PDV</button>
                  </div>
                )}

                {userError && <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{userError}</div>}
                {userMessage && <div className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{userMessage}</div>}

                <div className="mt-4">
                  {usersLoading ? <div className="py-4 text-center text-sm text-muted-foreground">Carregando usuários...</div> : pdvUsers.length === 0 ? <div className="py-4 text-center text-sm text-muted-foreground">Nenhum usuário de PDV cadastrado.</div> : pdvUsers.map(user => (
                    <div key={user.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 py-3 last:border-0">
                      <div className="min-w-40 flex-1"><div className="font-semibold text-foreground">{user.display_name || user.username}</div><div className="font-mono text-[11px] text-muted-foreground">@{user.username}</div></div>
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold">{user.active ? "Ativo" : "Desativado"}</span>
                      <div className="w-full rounded-xl bg-background/70 p-3 mt-2"><div className="mb-2 text-xs font-semibold text-muted-foreground">PERMISSÕES DE ACESSO</div><div className="flex flex-wrap gap-3">{["PDV","Conferência","Validade","Fiado","Gerência"].map(area => <label key={area} className="flex items-center gap-1.5 text-xs text-foreground"><input type="checkbox" checked={(user.permissions ?? ["PDV","Conferência"]).includes(area)} disabled={area === "PDV"} onChange={e => void saveUserPermissions(user, e.target.checked ? [...(user.permissions ?? ["PDV","Conferência"]), area] : (user.permissions ?? ["PDV","Conferência"]).filter(p => p !== area))} className="accent-primary" />{area}</label>)}</div><p className="mt-2 text-xs text-muted-foreground">A permissão Gerência libera a tentativa de entrada, mas a senha da Gerência continua obrigatória.</p></div><button onClick={() => void resetPdvPassword(user)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground">Trocar senha</button>
                      <button onClick={() => void togglePdvUser(user)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground">{user.active ? "Desativar" : "Ativar"}</button>
                      <button onClick={() => void deletePdvUser(user)} disabled={deletingUserId === user.id} className="rounded-lg border border-destructive/30 px-3 py-2 text-xs font-semibold text-destructive disabled:opacity-50">{deletingUserId === user.id ? "Excluindo..." : "Excluir"}</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border/60 p-5">
            <button type="button" onClick={() => setPixSectionOpen(open => !open)} aria-expanded={pixSectionOpen} className="flex w-full items-center justify-between gap-3 text-left">
              <div>
                <h2 className="font-semibold text-heading">Pagamento Pix</h2>
                <p className="mt-1 text-sm text-muted-foreground">Configure a chave Pix usada para gerar QR Codes no PDV.</p>
              </div>
              {pixSectionOpen ? <ChevronDown className="h-5 w-5 shrink-0 text-green-600" /> : <ChevronRight className="h-5 w-5 shrink-0 text-green-600" />}
            </button>
            {pixSectionOpen && (
              <div className="mt-4 border-t border-border/50 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Chave Pix e segurança de alteração</span>
                  {!pixEditing && (
                    <button onClick={() => void unlockPixEditing()} disabled={pixChecking} className="inline-flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground ring-1 ring-border disabled:opacity-50" type="button">
                      <LockKeyhole className="h-4 w-4 text-green-600" />{pixChecking ? "Validando..." : "Alterar chave"}
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
                          <option value="telefone">Telefone</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">E-mail</option><option value="aleatoria">Aleatória</option>
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
            )}
          </div>

          <div className="rounded-2xl border border-border/60 p-5">
            <button type="button" onClick={() => setCompanyIdentityOpen(open => !open)} aria-expanded={companyIdentityOpen} className="flex w-full items-center justify-between gap-3 text-left">
              <div>
                <h2 className="font-semibold text-heading">Identidade da empresa</h2>
                <p className="mt-1 text-sm text-muted-foreground">Nome e logo exibidos no sistema.</p>
              </div>
              {companyIdentityOpen ? <ChevronDown className="h-5 w-5 shrink-0 text-green-600" /> : <ChevronRight className="h-5 w-5 shrink-0 text-green-600" />}
            </button>
            {companyIdentityOpen && (
              <div className="mt-4 border-t border-border/50 pt-4">
                <div className="grid items-center gap-5 md:grid-cols-[120px_1fr]">
                  <div className="grid h-28 w-28 place-items-center overflow-hidden rounded-2xl bg-secondary ring-1 ring-border">
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
            )}
          </div>
        </section>

        <section className="glass p-5 md:p-6">
          <button type="button" onClick={() => setResetSectionOpen(open => !open)} aria-expanded={resetSectionOpen} className="flex w-full items-center justify-between gap-3 text-left">
            <h2 className="font-semibold text-heading">Zerar aplicação</h2>
            {resetSectionOpen ? <ChevronDown className="h-5 w-5 shrink-0 text-green-600" /> : <ChevronRight className="h-5 w-5 shrink-0 text-green-600" />}
          </button>
          {resetSectionOpen && <>
            <p className="mt-2 text-sm text-muted-foreground">Apaga os dados da empresa para começar do zero: produtos e fotos, vendas, estoque, conferências, recebimentos, fornecedores, promoções, chave Pix, nome e logo. O login e a conta permanecem.</p>
            <button onClick={openReset} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-destructive px-5 py-3 font-semibold text-destructive-foreground hover:opacity-90"><Trash2 className="h-4 w-4" />Zerar tudo e começar do zero</button>
          </>}
          {resetOpen && (
            <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
              <div className="w-full max-w-md glass p-6 shadow-2xl">
                <AlertTriangle className="h-6 w-6 text-destructive" />
                <h3 className="mt-2 text-lg font-semibold text-heading">Confirmar zerar aplicação</h3>
                <p className="mt-2 text-sm text-muted-foreground">Esta ação não pode ser desfeita. Todos os dados e as configurações da empresa serão apagados; o login continuará ativo.</p>
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
