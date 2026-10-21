import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, LockKeyhole, Trash2, AlertTriangle } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { actions, hydrateStore, useStore } from "@/lib/store";
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
  const [securityModal, setSecurityModal] = useState<"pix" | "reset" | "reset-final" | "reset-user" | "users-details" | null>(null);
  const [securityPassword, setSecurityPassword] = useState("");
  const [securityError, setSecurityError] = useState("");
  const [securityBusy, setSecurityBusy] = useState(false);
  const [passwordResetUser, setPasswordResetUser] = useState<{ id: string; username: string } | null>(null);
  const [pdvUsers, setPdvUsers] = useState<Array<{ id: string; username: string; display_name?: string | null; active: boolean; permissions?: string[] }>>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userName, setUserName] = useState("");
  const [userUsername, setUserUsername] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [newUserPermissions, setNewUserPermissions] = useState<string[]>(["PDV", "Conferência"]);
  const [userMessage, setUserMessage] = useState("");
  const [userError, setUserError] = useState("");
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [savingPermissionsUserId, setSavingPermissionsUserId] = useState<string | null>(null);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
  const [creatingPdvUser, setCreatingPdvUser] = useState(false);
  const [usersDetailsOpen, setUsersDetailsOpen] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("mobflow-first-manager-setup") === "1") {
      setUsersDetailsOpen(true);
      setAddUserOpen(true);
      sessionStorage.removeItem("mobflow-first-manager-setup");
    }
  }, []);

  useEffect(() => {
    let active = true;
    const verifyManager = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          if (active) navigate({ to: "/gerencia" });
          return;
        }

        // A Gerência já foi desbloqueada com a senha na tela anterior.
        // Confirme a permissão pelo servidor para não depender de uma consulta
        // direta a profiles que pode ser bloqueada por RLS.
        const { data: status, error: statusError } = await supabase.functions.invoke(
          "mobflow-reauth-manager",
          { body: { action: "status" } },
        );
        const allowedRole = status?.role === "manager" || status?.role === "pdv";
        const unlocked = sessionStorage.getItem("mobflow-management") === "1";
        const allowed = !statusError && status?.configured === true && allowedRole && unlocked;

        if (!active) return;
        if (!allowed) {
          sessionStorage.removeItem("mobflow-management");
          navigate({ to: "/gerencia" });
          return;
        }

        // Somente a conta principal da empresa pode ver e gerenciar usuários do PDV.
        if (status.role === "manager") {
          setUsersLoading(true);
          setUserError("");
          const { data, error: usersError } = await callUsers({ body: { action: "list" } });
          if (!active) return;
          if (usersError || !data?.users) setUserError(data?.error || "Não foi possível carregar os usuários.");
          else setPdvUsers(data.users);
          setUsersLoading(false);
        }
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
    if (creatingPdvUser) return;
    setCreatingPdvUser(true);
    setUserError("");
    setUserMessage("");
    const { data, error } = await callUsers({
      body: { action: "create", displayName: userName, username: userUsername, password: userPassword, permissions: newUserPermissions },
    });
    if (error || !data?.ok) {
      setUserError(data?.error || "Não foi possível criar o usuário.");
      setCreatingPdvUser(false);
      return;
    }
    setUserName("");
    setUserUsername("");
    setUserPassword("");
    setNewUserPermissions(["PDV", "Conferência"]);
    setUserMessage("Usuário criado com sucesso.");
    await loadPdvUsers();
    setCreatingPdvUser(false);
  };

  const togglePdvUser = async (user: (typeof pdvUsers)[number]) => {
    if (togglingUserId || savingPermissionsUserId || deletingUserId) return;
    setTogglingUserId(user.id);
    setUserError("");
    const { data, error } = await callUsers({
      body: { action: "toggle", userId: user.id, active: !user.active },
    });
    if (error || !data?.ok) setUserError(data?.error || "Não foi possível alterar o acesso.");
    else await loadPdvUsers();
    setTogglingUserId(null);
  };

  const resetPdvPassword = async (user: (typeof pdvUsers)[number]) => {
    setPasswordResetUser({ id: user.id, username: user.username });
    setSecurityPassword(""); setSecurityError(""); setSecurityModal("reset-user");
  };

  const submitSecurityModal = async () => {
    if (securityBusy) return;
    setSecurityError("");
    if (securityModal === "users-details") {
      if (!securityPassword.trim()) { setSecurityError("Informe a senha da gerência."); return; }
      setSecurityBusy(true);
      const result = await verifyManagerPassword(securityPassword);
      setSecurityBusy(false);
      if (!result.ok) { setSecurityError(result.error || "Senha da gerência incorreta."); return; }
      setSecurityModal(null); setSecurityPassword(""); setSecurityError("");
      setUsersDetailsOpen(true);
      await loadPdvUsers();
      return;
    }
    if (securityModal === "reset-user") {
      if (securityPassword.length < 6) { setSecurityError("A senha precisa ter pelo menos 6 caracteres."); return; }
      setSecurityBusy(true);
      const result = await callUsers({ body: { action: "reset_password", userId: passwordResetUser?.id, password: securityPassword } });
      setSecurityBusy(false);
      if (result.error || !result.data?.ok) { setSecurityError(result.data?.error || "Não foi possível trocar a senha."); return; }
      setSecurityModal(null); setSecurityPassword(""); setPasswordResetUser(null); setUserMessage("Senha alterada."); return;
    }
    if (!securityPassword.trim()) { setSecurityError("Informe a senha da gerência."); return; }
    setSecurityBusy(true);
    const result = await verifyManagerPassword(securityPassword);
    setSecurityBusy(false);
    if (!result.ok) { setSecurityError(result.error || "Senha da gerência incorreta."); return; }
    if (securityModal === "pix") {
      setPixEditing(true); setPixError(""); setSecurityModal(null); setSecurityPassword("");
    } else if (securityModal === "reset") {
      setSecurityModal("reset-final"); setSecurityError("");
    }
  };


  const saveUserPermissions = async (user: (typeof pdvUsers)[number], permissions: string[]) => {
    if (savingPermissionsUserId || togglingUserId || deletingUserId) return;
    setSavingPermissionsUserId(user.id);
    setUserError("");
    const { data, error } = await callUsers({ body: { action: "update_permissions", userId: user.id, permissions } });
    if (error || !data?.ok) setUserError(data?.error || "Não foi possível salvar as permissões.");
    else { setUserMessage(`Permissões de ${user.username} atualizadas.`); await loadPdvUsers(); }
    setSavingPermissionsUserId(null);
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
    setSecurityPassword(""); setSecurityError(""); setSecurityModal("pix");
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
    if (!securityPassword.trim()) { setSecurityError("Informe a senha da gerência."); return; }
    setSecurityError(""); setSecurityBusy(true);
    const result = await callUsers({ body: { action: "reset_application", managerPassword: securityPassword } });
    setSecurityBusy(false);
    if (result.error || !result.data?.ok || result.data?.cloudCleared !== true) {
      setSecurityError(result.data?.error || "O Supabase não confirmou a limpeza completa. A aplicação não foi marcada como zerada."); return;
    }
    await hydrateStore(); actions.resetAppData();
    setName(""); setLogo(""); setPixKey(""); setPixKeyType("aleatoria"); setPixEditing(false); setSaved(false);
    setPdvUsers([]); setUsersDetailsOpen(true); setAddUserOpen(true);
    setResetOpen(false); setSecurityModal(null); setSecurityPassword(""); setSecurityError(""); setResetError("");
    setUserMessage("Limpeza confirmada. " + (result.data.deleted ?? 0) + " usuário(s) do PDV excluído(s). A senha da Gerência foi preservada. Cadastre agora o novo usuário do PDV.");
  };


  return (
    <div className="mfb-in min-h-screen p-4 md:p-6">
      <AppHeader />
      <main className="w-full max-w-7xl mx-auto space-y-5">
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
                  if (usersDetailsOpen) {
                    setUsersDetailsOpen(false);
                    setAddUserOpen(false);
                    return;
                  }
                  setSecurityPassword("");
                  setSecurityError("");
                  setSecurityModal("users-details");
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
                    <button type="button" onClick={() => void loadPdvUsers()} disabled={usersLoading} className="rounded-xl bg-secondary px-3 py-2 text-sm text-secondary-foreground disabled:opacity-50">{usersLoading ? "Carregando..." : "Atualizar"}</button>
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
                    <div className="mt-3 rounded-xl border border-border/60 bg-background/70 p-3">
                      <div className="mb-2 text-xs font-semibold text-muted-foreground">PERMISSÕES DE ACESSO</div>
                      <div className="flex flex-wrap gap-3">{["PDV", "Conferência", "Validade", "Fiado", "Gerência"].map(area => <label key={area} className="flex items-center gap-1.5 text-sm text-foreground"><input type="checkbox" checked={newUserPermissions.includes(area)} onChange={e => setNewUserPermissions(current => e.target.checked ? [...current, area] : current.filter(permission => permission !== area))} className="accent-primary" />{area}</label>)}</div>
                      <p className="mt-2 text-xs text-muted-foreground">Para um conferente usar somente a Conferência, marque apenas essa opção. O primeiro usuário da empresa continua recebendo Gerência automaticamente para não bloquear a configuração inicial.</p>
                    </div>
                    <button type="button" onClick={() => void createPdvUser()} disabled={creatingPdvUser || userUsername.trim().length < 3 || userPassword.length < 6} className="mt-3 w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-40">{creatingPdvUser ? "Aguarde, criando usuário..." : "Criar usuário do PDV"}</button>
                  </div>
                )}

                {userError && <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{userError}</div>}
                {userMessage && <div className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{userMessage}</div>}

                <div className="mt-4">
                  {usersLoading ? <div className="py-4 text-center text-sm text-muted-foreground">Carregando usuários...</div> : pdvUsers.length === 0 ? <div className="py-4 text-center text-sm text-muted-foreground">Nenhum usuário de PDV cadastrado.</div> : pdvUsers.map(user => (
                    <div key={user.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 py-3 last:border-0">
                      <div className="min-w-40 flex-1"><div className="font-semibold text-foreground">{user.display_name || user.username}</div><div className="font-mono text-[11px] text-muted-foreground">@{user.username}</div></div>
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold">{user.active ? "Ativo" : "Desativado"}</span>
                      <div className="w-full rounded-xl bg-background/70 p-3 mt-2"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-semibold text-muted-foreground">PERMISSÕES DE ACESSO</div>{savingPermissionsUserId === user.id && <span role="status" className="text-xs font-semibold text-primary">Salvando permissões… aguarde</span>}</div><div className="flex flex-wrap gap-3">{["PDV","Conferência","Validade","Fiado","Gerência"].map(area => <label key={area} className={`flex items-center gap-1.5 text-xs text-foreground ${savingPermissionsUserId === user.id ? "opacity-60" : ""}`}><input type="checkbox" checked={(user.permissions ?? ["PDV","Conferência"]).includes(area)} disabled={area === "PDV" || !!savingPermissionsUserId || !!togglingUserId || !!deletingUserId} onChange={e => void saveUserPermissions(user, e.target.checked ? [...(user.permissions ?? ["PDV","Conferência"]), area] : (user.permissions ?? ["PDV","Conferência"]).filter(p => p !== area))} className="accent-primary" />{area}</label>)}</div><p className="mt-2 text-xs text-muted-foreground">A permissão Gerência libera a tentativa de entrada, mas a senha da Gerência continua obrigatória.</p></div><button onClick={() => void resetPdvPassword(user)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground">Trocar senha</button>
                      <button onClick={() => void togglePdvUser(user)} disabled={togglingUserId === user.id || !!savingPermissionsUserId || !!deletingUserId} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground disabled:opacity-50">{togglingUserId === user.id ? "Aguarde..." : user.active ? "Desativar" : "Ativar"}</button>
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
                  <button onClick={() => { setSecurityPassword(""); setSecurityError(""); setResetOpen(false); setSecurityModal("reset"); }} className="flex-1 rounded-xl bg-destructive px-4 py-3 font-semibold text-destructive-foreground hover:opacity-90">Continuar</button>
                </div>
              </div>
            </div>
          )}
        </section>

      {securityModal && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-background/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <form onSubmit={(e) => { e.preventDefault(); if (securityModal === "reset-final") void reset(); else void submitSecurityModal(); }} className="w-full max-w-md glass p-6 shadow-2xl">
            <LockKeyhole className="h-6 w-6 text-green-600" />
            <h3 className="mt-2 text-lg font-semibold text-heading">{securityModal === "pix" ? "Confirmar senha da Gerência" : securityModal === "users-details" ? "Confirmar senha da Gerência" : securityModal === "reset-user" ? "Trocar senha de " + (passwordResetUser?.username ?? "usuário") : securityModal === "reset" ? "Senha da Gerência" : "Confirmar limpeza definitiva"}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{securityModal === "pix" ? "Digite a senha da Gerência para liberar a alteração da chave Pix." : securityModal === "users-details" ? "Para evitar aberturas acidentais, confirme a senha da Gerência para visualizar os detalhes e gerenciar usuários." : securityModal === "reset-user" ? "Defina uma nova senha para este usuário do PDV (mínimo de 6 caracteres)." : securityModal === "reset" ? "Para continuar, confirme a senha da Gerência desta empresa." : "Esta ação apagará os dados desta empresa e excluirá os usuários do PDV vinculados a ela. O login da Gerência e as outras empresas não serão afetados."}</p>
            {securityModal !== "reset-final" && <input type="password" value={securityPassword} onChange={e => { setSecurityPassword(e.target.value); setSecurityError(""); }} placeholder={securityModal === "reset-user" ? "Nova senha (mínimo 6 caracteres)" : "Senha da Gerência"} autoComplete="current-password" autoFocus className="field mt-4 w-full text-foreground" />}
            {securityError && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{securityError}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => { setSecurityModal(null); setSecurityPassword(""); setSecurityError(""); setPasswordResetUser(null); }} className="flex-1 rounded-xl bg-secondary px-4 py-3 text-sm font-semibold text-secondary-foreground">Cancelar</button>
              <button type="submit" disabled={securityBusy} className={"flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 " + (securityModal === "reset-final" ? "bg-destructive" : "bg-primary")}>{securityBusy ? "Aguarde..." : securityModal === "reset-final" ? "Zerar aplicação" : securityModal === "reset-user" ? "Salvar nova senha" : "Confirmar senha"}</button>
            </div>
          </form>
        </div>
      )}
      </main>
    </div>
  );
}
