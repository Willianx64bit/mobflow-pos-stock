import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import { LogOut } from "lucide-react";

const AUTH_KEY = "mobflow-authenticated";
const REMEMBER_KEY = "mobflow-remember-login";

export function isAuthenticated() {
  return localStorage.getItem(AUTH_KEY) === "1";
}

export async function logout() {
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem("mobflow-role");
  sessionStorage.removeItem("mobflow-username");
  sessionStorage.removeItem("mobflow-management");
  sessionStorage.removeItem("mobflow-pdv-authorized");
  await supabase.auth.signOut();
}

export function LoginScreen({ onLogin, onClose, mode = "empresa" }: { onLogin: (options?: { firstManagerLogin?: boolean }) => void; onClose?: () => void; mode?: "empresa" | "pdv" }) {
  const companySettings = useStore((s) => s.settings);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(() => localStorage.getItem(REMEMBER_KEY) === "1");
  const [showAccountLogoutConfirm, setShowAccountLogoutConfirm] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryUsername, setRecoveryUsername] = useState("");
  const [recoveryCnpj, setRecoveryCnpj] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  // O login do operador deve sempre começar vazio, sem reaproveitar/autopreencher credenciais da empresa.
  useEffect(() => {
    if (mode === "pdv") {
      setUsername("");
      setPassword("");
      setError("");
      setRememberLogin(false);
    }
  }, [mode]);

  const logoutAccount = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem("mobflow-role");
    sessionStorage.removeItem("mobflow-username");
    sessionStorage.removeItem("mobflow-pdv-authorized");
    sessionStorage.removeItem("mobflow-management");
    sessionStorage.removeItem("mobflow-permissions");
    setShowAccountLogoutConfirm(false);
    window.dispatchEvent(new Event("mobflow-auth-changed"));
  };

  const formatCnpj = (value: string) => value.replace(/\D/g, "").slice(0, 14).replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");

  const requestPasswordRecovery = async (event: FormEvent) => {
    event.preventDefault();
    setRecoveryMessage("");
    const cleanUsername = recoveryUsername.trim();
    const cleanCnpj = recoveryCnpj.replace(/\D/g, "");
    if (!cleanUsername || cleanCnpj.length !== 14) {
      setRecoveryMessage("Informe o usuário e o CNPJ completo da empresa.");
      return;
    }
    setRecoveryLoading(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("mobflow-manager-password-recovery", {
        body: { action: "request", username: cleanUsername, cnpj: cleanCnpj },
      });
      if (invokeError || !data?.ok) {
        let detail = String(data?.error ?? "");
        try { if (!detail) detail = String((await (invokeError as { context?: Response })?.context?.json())?.error ?? ""); } catch {}
        setRecoveryMessage(detail || "Não foi possível processar a solicitação agora. Tente novamente mais tarde.");
        return;
      }
      setRecoveryMessage(data.message || "Se os dados corresponderem a uma conta de Gerência com e-mail cadastrado, enviaremos um link de recuperação.");
    } catch {
      setRecoveryMessage("Não foi possível conectar ao serviço de recuperação.");
    } finally {
      setRecoveryLoading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    localStorage.setItem(REMEMBER_KEY, rememberLogin ? "1" : "0");
    if (!rememberLogin) localStorage.removeItem(AUTH_KEY);

    try {
      // Reutiliza o CNPJ da empresa atual sem pedir que o operador o digite.
      // O login da gerência o salva; se existir sessão ativa, confirmamos pelo perfil.
      let loginCnpj = cnpj.replace(/\D/g, "");
      if (mode === "pdv") {
        loginCnpj = (localStorage.getItem("mobflow-company-cnpj") || "").replace(/\D/g, "");
        const { data: sessionData } = await supabase.auth.getSession();
        const currentUser = sessionData.session?.user;
        if (currentUser) {
          const { data: currentProfile, error: profileError } = await supabase
            .from("profiles")
            .select("cnpj, role")
            .eq("id", currentUser.id)
            .maybeSingle();
          if (!profileError && currentProfile?.cnpj && ["manager", "pdv"].includes(currentProfile.role)) {
            loginCnpj = String(currentProfile.cnpj).replace(/\D/g, "");
            localStorage.setItem("mobflow-company-cnpj", loginCnpj);
          }
        }
        if (loginCnpj.length !== 14) {
          setError("Não foi possível identificar a empresa. Entre novamente na gerência.");
          return;
        }
      }

      // Limpa a sessão anterior somente depois de obter o CNPJ da empresa atual.
      await supabase.auth.signOut();
      sessionStorage.removeItem("mobflow-management");
      sessionStorage.removeItem("mobflow-pdv-authorized");
      sessionStorage.removeItem("mobflow-role");
      sessionStorage.removeItem("mobflow-username");

      const { data, error } = await supabase.functions.invoke("mobflow-login", {
        body: { username: username.trim(), password, cnpj: loginCnpj, expectedRole: mode === "pdv" ? "pdv" : "manager" },
      });

      if (error || !data?.session) {
        // Nunca revelar se o usuário existe ou se pertence a outra empresa.
        setError("Usuário ou senha inválido.");
        return;
      }

      if (mode === "pdv" && data.profile?.role !== "pdv") {
        setError("Usuário ou senha inválido.");
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });

      if (sessionError) {
        setError("Não foi possível iniciar a sessão.");
        return;
      }

      localStorage.setItem(AUTH_KEY, "1");
      if (mode === "empresa") localStorage.setItem("mobflow-company-cnpj", loginCnpj);
      if (mode === "pdv") sessionStorage.setItem("mobflow-pdv-authorized", "1");
      sessionStorage.setItem("mobflow-role", data.profile?.role || (mode === "pdv" ? "pdv" : "manager"));
      sessionStorage.setItem("mobflow-username", data.profile?.username || username.trim().toUpperCase());
      sessionStorage.setItem("mobflow-permissions", JSON.stringify(data.profile?.permissions || (data.profile?.role === "manager" ? ["PDV", "Conferência", "Validade", "Fiado", "Gerência"] : ["PDV", "Conferência"])));
      const firstManagerLogin = mode === "empresa" && data.firstManagerLogin === true;
      if (firstManagerLogin) sessionStorage.setItem("mobflow-first-manager-setup", "1");
      onLogin({ firstManagerLogin });
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background px-4 py-6">
      <div className="mfb-in relative w-full max-w-md rounded-2xl bg-surface ring-1 ring-border p-6 sm:p-8">
        {mode === "pdv" && !onClose && (
          <button type="button" onClick={() => setShowAccountLogoutConfirm(true)} className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label="Sair da conta" title="Sair da conta">
            <LogOut className="h-4 w-4" /><span>Sair da conta</span>
          </button>
        )}
        {mode === "pdv" && onClose && <button type="button" onClick={onClose} aria-label="Fechar login do PDV" title="Fechar" className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"><span aria-hidden="true" className="text-2xl leading-none">×</span></button>}
        {showAccountLogoutConfirm && mode === "pdv" && !onClose && (
          <div className="fixed inset-0 z-[120] grid place-items-center bg-black/45 p-4 backdrop-blur-sm" onClick={() => setShowAccountLogoutConfirm(false)}>
            <div className="w-full max-w-sm rounded-2xl bg-popover p-6 text-center shadow-2xl ring-1 ring-border" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-secondary text-foreground ring-1 ring-border"><LogOut className="h-6 w-6" /></div>
              <h2 className="mt-3 font-display text-2xl tracking-[.08em] text-heading">SAIR DA CONTA?</h2>
              <p className="mt-2 text-sm text-muted-foreground">Você voltará ao login da empresa. Os dados salvos não serão apagados.</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setShowAccountLogoutConfirm(false)} className="rounded-xl bg-secondary py-3 font-semibold text-secondary-foreground ring-1 ring-border hover:bg-accent">Cancelar</button>
                <button type="button" onClick={logoutAccount} className="rounded-xl bg-red-600 py-3 font-bold text-white hover:bg-red-700">Sair da conta</button>
              </div>
            </div>
          </div>
        )}
        <div className="mx-auto w-full max-w-[320px] text-center">
          <img src="/mobflow-logo.svg" alt="MobFlow — PDV e estoque" className="mx-auto block h-auto w-full max-w-[280px] object-contain" />
        </div>

        {mode === "pdv" && (
          <div className="mt-6 text-center">
            {companySettings.companyLogo ? (
              <img src={companySettings.companyLogo} alt={companySettings.companyName || "Logo da empresa"} className="mx-auto h-24 w-24 rounded-full border border-border bg-background object-contain p-1 shadow-sm" />
            ) : (
              <div className="mx-auto grid h-24 w-24 place-items-center rounded-full border border-border bg-secondary font-display text-3xl text-primary">
                {(companySettings.companyName || "M").trim().charAt(0).toUpperCase()}
              </div>
            )}
            <h2 className="mt-4 font-display text-2xl tracking-[.06em] text-heading">{companySettings.companyName || "Sua empresa"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Acesso de usuário</p>
          </div>
        )}

        <div className="mt-8 text-center">
          <h1 className="font-display text-xl tracking-[.1em] text-heading">{mode === "pdv" ? "LOGIN DO USUÁRIO" : "LOGIN DA EMPRESA"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{mode === "pdv" ? "Informe seu usuário e senha para continuar." : "Informe os dados da empresa para entrar."}</p>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4" autoComplete="off">
          <div>
            <label className="label-mono block mb-1.5">Usuário</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete={mode === "pdv" ? "new-password" : "off"} name={mode === "pdv" ? "operator-login-field" : "company-login"} placeholder="Nome de usuário" className="field w-full text-foreground" autoFocus />
          </div>

          <div>
            <label className="label-mono block mb-1.5">Senha</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete={mode === "pdv" ? "new-password" : "current-password"} name={mode === "pdv" ? "operator-password-field" : "company-password"} placeholder="Senha" className="field w-full text-foreground" />
          </div>
          {mode === "empresa" && (
            <div className="-mt-2 text-right">
              <button type="button" onClick={() => {
                setRecoveryUsername(username);
                setRecoveryCnpj(cnpj);
                setRecoveryMessage("");
                setRecoveryOpen(true);
              }} className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
                Esqueci minha senha
              </button>
            </div>
          )}

          {error && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{error}</div>}

          {mode !== "pdv" && (
            <div>
              <label className="label-mono block mb-1.5">CNPJ</label>
              <input value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} inputMode="numeric" autoComplete="organization" placeholder="00.000.000/0000-00" className="field w-full text-foreground" required />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={mode === "pdv" ? false : rememberLogin} disabled={mode === "pdv"} onChange={(e) => setRememberLogin(e.target.checked)} className="h-4 w-4 accent-primary" />
            <span>Salvar login</span>
          </label>

          <button type="submit" disabled={loading} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground hover:bg-primary/85 transition-colors disabled:opacity-50">
            {loading ? "Validando..." : "Entrar"}
          </button>
          {mode === "pdv" && onClose && (
            <button type="button" onClick={onClose} className="w-full rounded-xl border border-border bg-transparent py-3 font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              Cancelar
            </button>
          )}
        </form>

        <p className="mt-5 text-center font-mono text-[10px] text-muted-foreground">Acesso restrito · informe as credenciais cadastradas</p>

        {recoveryOpen && mode === "empresa" && (
          <div className="fixed inset-0 z-[130] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
            <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl ring-1 ring-border">
              <h2 id="recovery-title" className="text-center font-display text-xl text-heading">Recuperar senha da Gerência</h2>
              <p className="mt-2 text-center text-sm text-muted-foreground">Informe o usuário e o CNPJ da empresa. O link será enviado ao e-mail cadastrado, se os dados corresponderem à conta da Gerência.</p>
              <form onSubmit={(e) => void requestPasswordRecovery(e)} className="mt-5 space-y-3">
                <input value={recoveryUsername} onChange={(e) => { setRecoveryUsername(e.target.value); setRecoveryMessage(""); }} placeholder="Usuário da empresa" autoComplete="username" className="field w-full text-foreground" required />
                <input value={recoveryCnpj} onChange={(e) => { setRecoveryCnpj(formatCnpj(e.target.value)); setRecoveryMessage(""); }} inputMode="numeric" placeholder="CNPJ da empresa" autoComplete="organization" className="field w-full text-foreground" required />
                {recoveryMessage && <div role="status" className="rounded-lg bg-secondary/70 px-3 py-2 text-center text-sm text-muted-foreground">{recoveryMessage}</div>}
                <button type="submit" disabled={recoveryLoading} className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-50">{recoveryLoading ? "Solicitando..." : "Enviar link de recuperação"}</button>
                <button type="button" onClick={() => { setRecoveryOpen(false); setRecoveryMessage(""); }} className="w-full rounded-xl bg-secondary py-3 font-semibold text-secondary-foreground">Fechar</button>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
