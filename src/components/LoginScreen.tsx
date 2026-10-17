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

export function LoginScreen({ onLogin, onClose, mode = "empresa" }: { onLogin: () => void; onClose?: () => void; mode?: "empresa" | "pdv" }) {
  const companySettings = useStore((s) => s.settings);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(() => localStorage.getItem(REMEMBER_KEY) === "1");
  const [showAccountLogoutConfirm, setShowAccountLogoutConfirm] = useState(false);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [requestCompanyName, setRequestCompanyName] = useState("");
  const [requestUsername, setRequestUsername] = useState("");
  const [requestCnpj, setRequestCnpj] = useState("");
  const [requestPhone, setRequestPhone] = useState("");
  const [requestMessage, setRequestMessage] = useState("");

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

  const submitNewAccountRequest = (e: FormEvent) => {
    e.preventDefault();
    const company = requestCompanyName.trim();
    const requestedUsername = requestUsername.trim();
    const digitsCnpj = requestCnpj.replace(/\D/g, "");
    const phone = requestPhone.trim();

    if (!company || !requestedUsername || digitsCnpj.length !== 14 || !phone) {
      setRequestMessage("Preencha todos os campos e informe um CNPJ válido.");
      return;
    }

    const subject = encodeURIComponent("Solicitação de nova conta MobFlow");
    const body = encodeURIComponent(
      "Solicitação de criação de conta MobFlow\n\n" +
      "Nome da empresa: " + company + "\n" +
      "Nome de usuário desejado: " + requestedUsername + "\n" +
      "CNPJ: " + requestCnpj + "\n" +
      "Telefone: " + phone + "\n\n" +
      "Solicitação pendente de aprovação. A senha será definida de forma segura após a criação da conta."
    );
    setRequestMessage("Abrindo seu aplicativo de e-mail. Confira a mensagem e toque em Enviar para concluir a solicitação.");
    window.location.href = `mailto:williannunesx456@gmail.com?subject=${subject}&body=${body}`;
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
      if (mode !== "pdv") localStorage.setItem("mobflow-company-cnpj", loginCnpj);
      if (mode === "pdv") sessionStorage.setItem("mobflow-pdv-authorized", "1");
      sessionStorage.setItem("mobflow-role", data.profile?.role === "manager" ? "manager" : "pdv");
      sessionStorage.setItem("mobflow-username", data.profile?.username || username.trim().toUpperCase());
      sessionStorage.setItem("mobflow-permissions", JSON.stringify(data.profile?.permissions || (data.profile?.role === "manager" ? ["PDV", "Conferência", "Validade", "Fiado", "Gerência"] : ["PDV", "Conferência"])));
      onLogin();
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
        {showNewAccount && mode !== "pdv" && (
          <div className="fixed inset-0 z-[130] grid place-items-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm" onClick={() => setShowNewAccount(false)}>
            <div className="my-6 w-full max-w-md rounded-2xl bg-popover p-6 shadow-2xl ring-1 ring-border" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl tracking-[.08em] text-heading">ABRIR NOVA CONTA</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Preencha os dados para solicitar o cadastro da sua empresa.</p>
                </div>
                <button type="button" onClick={() => { setShowNewAccount(false); setRequestMessage(""); }} aria-label="Fechar" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent"><span className="text-2xl leading-none">×</span></button>
              </div>
              <form onSubmit={submitNewAccountRequest} className="mt-5 space-y-3">
                <div>
                  <label className="label-mono mb-1.5 block">Nome da empresa</label>
                  <input value={requestCompanyName} onChange={(e) => setRequestCompanyName(e.target.value)} autoComplete="organization" placeholder="Nome da empresa" className="field w-full text-foreground" required />
                </div>
                <div>
                  <label className="label-mono mb-1.5 block">Nome de usuário desejado</label>
                  <input value={requestUsername} onChange={(e) => setRequestUsername(e.target.value)} autoComplete="off" placeholder="Como deseja entrar no sistema" className="field w-full text-foreground" required />
                </div>
                <div>
                  <label className="label-mono mb-1.5 block">CNPJ</label>
                  <input value={requestCnpj} onChange={(e) => setRequestCnpj(formatCnpj(e.target.value))} inputMode="numeric" autoComplete="off" placeholder="00.000.000/0000-00" className="field w-full text-foreground" required />
                </div>
                <div>
                  <label className="label-mono mb-1.5 block">Número de telefone</label>
                  <input value={requestPhone} onChange={(e) => setRequestPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" className="field w-full text-foreground" required />
                </div>
                <p className="rounded-lg bg-secondary/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground">Por segurança, não envie sua senha por e-mail. Após analisar o pedido, a conta será criada e a senha definida de forma segura.</p>
                {requestMessage && <p role="status" className="rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">{requestMessage}</p>}
                <button type="submit" className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground transition-colors hover:bg-primary/85">Enviar solicitação por e-mail</button>
              </form>
            </div>
          </div>
        )}
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
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete={mode === "pdv" ? "new-password" : "username"} name={mode === "pdv" ? "operator-login-field" : "company-login"} placeholder="Nome de usuário" className="field w-full text-foreground" autoFocus />
          </div>

          <div>
            <label className="label-mono block mb-1.5">Senha</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete={mode === "pdv" ? "new-password" : "current-password"} name={mode === "pdv" ? "operator-password-field" : "company-password"} placeholder="Senha" className="field w-full text-foreground" />
          </div>

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

        {mode !== "pdv" && (
          <button type="button" onClick={() => { setShowNewAccount(true); setRequestMessage(""); }} className="mt-3 w-full rounded-xl border border-border bg-transparent py-3 font-semibold text-foreground transition-colors hover:bg-accent">
            Abrir nova conta
          </button>
        )}

        <p className="mt-5 text-center font-mono text-[10px] text-muted-foreground">Acesso restrito · informe as credenciais cadastradas</p>
      </div>
    </div>
  );
}
