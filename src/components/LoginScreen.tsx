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

export function LoginScreen({ onLogin, onClose, mode = "empresa" }: { onLogin: () => void; onClose?: () => void; mode?: "empresa" | "pdv" | "admin" }) {
  const companySettings = useStore((s) => s.settings);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [signupSuccess, setSignupSuccess] = useState("");
  const [signupComplete, setSignupComplete] = useState(false);
  const [signupAmount, setSignupAmount] = useState(79.90);
  const [signupPayment, setSignupPayment] = useState<{ pixCopyPaste: string; pixQrCode: string; pixRecipientName: string; amount: number } | null>(null);
  const [pixCopied, setPixCopied] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(() => localStorage.getItem(REMEMBER_KEY) === "1");
  const [showAccountLogoutConfirm, setShowAccountLogoutConfirm] = useState(false);

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

  const submitSignup = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSignupSuccess("");
    setSignupComplete(false);
    setSignupPayment(null);
    setPixCopied(false);
    try {
      const { data, error: signupError } = await supabase.functions.invoke("mobflow-signup", {
        body: {
          companyName: companyName.trim(),
          username: username.trim(),
          password,
          cnpj: cnpj.replace(/\D/g, ""),
          phone: phone.replace(/\D/g, ""),
          email: email.trim().toLowerCase(),
          paymentMethod: "pix",
        },
      });
      if (signupError || !data?.ok) {
        setError(data?.error || "Não foi possível criar a conta. Confira os dados e tente novamente.");
        return;
      }
      setSignupSuccess(data.message || "Cadastro recebido. O pagamento via Pix aguarda confirmação manual.");
      setSignupPayment(data.pixCopyPaste && data.pixQrCode ? {
        pixCopyPaste: data.pixCopyPaste,
        pixQrCode: data.pixQrCode,
        pixRecipientName: data.pixRecipientName || "MobFlow",
        amount: Number(data.amount) || signupAmount,
      } : null);
      setPixCopied(false);
      setSignupComplete(true);
      setCreatingAccount(false);
      setUsername("");
      setPassword("");
      setCnpj("");
      setCompanyName("");
      setPhone("");
      setEmail("");
    } catch {
      setError("Não foi possível conectar ao servidor para criar a conta.");
    } finally {
      setLoading(false);
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
        body: { username: username.trim(), password, cnpj: loginCnpj, expectedRole: mode === "admin" ? "admin" : mode === "pdv" ? "pdv" : "manager" },
      });

      if (error || !data?.session) {
        // Nunca revelar se o usuário existe ou se pertence a outra empresa.
        setError("Usuário ou senha inválido.");
        return;
      }

      if ((mode === "pdv" && data.profile?.role !== "pdv") || (mode === "admin" && data.profile?.role !== "admin")) {
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
      sessionStorage.setItem("mobflow-permissions", JSON.stringify(data.profile?.permissions || (data.profile?.role === "admin" ? ["Assinaturas", "Confirmação de pagamentos"] : data.profile?.role === "manager" ? ["PDV", "Conferência", "Validade", "Fiado", "Gerência"] : ["PDV", "Conferência"])));
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
          <h1 className="font-display text-xl tracking-[.1em] text-heading">{mode === "admin" ? "ADMINISTRAÇÃO MOBFLOW" : mode === "pdv" ? "LOGIN DO USUÁRIO" : signupComplete ? "CADASTRO RECEBIDO" : creatingAccount ? "CRIAR CONTA DA EMPRESA" : "LOGIN DA EMPRESA"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{mode === "admin" ? "Acesso reservado ao administrador de assinaturas." : mode === "pdv" ? "Informe seu usuário e senha para continuar." : signupComplete ? "Seu cadastro foi recebido; falta confirmar o pagamento." : creatingAccount ? "Preencha os dados e escolha a assinatura MobFlow." : "Informe os dados da empresa para entrar."}</p>
        </div>

        {signupSuccess && !creatingAccount && !signupComplete && <div className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-3 text-center text-sm text-foreground ring-1 ring-emerald-500/30">{signupSuccess}</div>}

        {!(creatingAccount && mode === "empresa") && !(signupComplete && mode === "empresa") && <form onSubmit={submit} className="mt-5 space-y-4" autoComplete="off">
          <div>
            <label className="label-mono block mb-1.5">Usuário</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete={mode === "pdv" ? "new-password" : "off"} name={mode === "pdv" ? "operator-login-field" : mode === "admin" ? "admin-login-field" : "company-login"} placeholder="Nome de usuário" className="field w-full text-foreground" autoFocus />
          </div>

          <div>
            <label className="label-mono block mb-1.5">Senha</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete={mode === "pdv" || mode === "admin" ? "new-password" : "current-password"} name={mode === "pdv" ? "operator-password-field" : mode === "admin" ? "admin-password-field" : "company-password"} placeholder="Senha" className="field w-full text-foreground" />
          </div>

          {error && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{error}</div>}

          {mode !== "pdv" && (
            <div>
              <label className="label-mono block mb-1.5">CNPJ</label>
              <input value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} inputMode="numeric" autoComplete={mode === "admin" ? "off" : "organization"} placeholder="00.000.000/0000-00" className="field w-full text-foreground" required />
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
        </form>}

        {signupComplete && mode === "empresa" && (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
              <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-600">
                <span className="text-2xl" aria-hidden="true">✓</span>
              </div>
              <h2 className="text-lg font-bold text-foreground">Cadastro recebido!</h2>
              <p className="mt-1 text-sm text-muted-foreground">Sua conta ainda não está liberada. O pagamento será conferido manualmente pelo administrador.</p>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-sm font-semibold text-foreground">Assinatura MobFlow Completo</p>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-2xl font-bold text-foreground">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(signupPayment?.amount ?? signupAmount)}</span>
                <span className="text-sm text-muted-foreground">/mês</span>
              </div>
              <div className="mt-4 rounded-lg border border-border bg-background p-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 font-bold">Pix</div>
                  <div>
                    <p className="font-semibold text-foreground">Forma de pagamento: Pix</p>
                    <p className="text-xs text-muted-foreground">Confirmação manual pelo MobFlow</p>
                  </div>
                </div>
                {signupPayment ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-foreground">Pague para <strong>{signupPayment.pixRecipientName}</strong> usando o QR Code ou o Pix copia e cola.</p>
                    <img src={signupPayment.pixQrCode} alt="QR Code Pix para pagamento da assinatura" className="mx-auto h-56 w-56 rounded-lg border border-border bg-white p-2" />
                    <label className="block text-xs font-semibold text-muted-foreground">Pix copia e cola</label>
                    <textarea value={signupPayment.pixCopyPaste} readOnly rows={4} className="w-full resize-none rounded-lg border border-border bg-background p-2 text-xs text-foreground" />
                    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(signupPayment.pixCopyPaste); setPixCopied(true); } catch { setPixCopied(false); } }} className="w-full rounded-lg border border-border px-3 py-2.5 text-sm font-semibold hover:bg-accent">{pixCopied ? "Código Pix copiado" : "Copiar código Pix"}</button>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-foreground">O Pix ainda não está configurado. Entre em contato com o administrador antes de realizar qualquer pagamento.</p>
                )}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">Após pagar, aguarde a conferência manual. O acesso será liberado quando o administrador confirmar o recebimento.</p>
            </div>
            <button type="button" onClick={() => { setSignupComplete(false); setSignupSuccess(""); setError(""); }} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground hover:bg-primary/85 transition-colors">
              Voltar para o login
            </button>
          </div>
        )}

        {creatingAccount && mode === "empresa" && (
          <form onSubmit={submitSignup} className="mt-5 space-y-4" autoComplete="off">
            <div>
              <label className="label-mono block mb-1.5">Nome da empresa</label>
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoComplete="organization" placeholder="Ex.: Mercado do João" className="field w-full text-foreground" required maxLength={120} />
            </div>
            <div>
              <label className="label-mono block mb-1.5">Nome de usuário</label>
              <input value={username} onChange={(e) => setUsername(e.target.value.toUpperCase())} autoComplete="username" placeholder="Crie seu usuário" className="field w-full text-foreground" required minLength={3} maxLength={40} />
              <p className="mt-1 text-xs text-muted-foreground">Use de 3 a 40 caracteres: letras, números, ponto, hífen ou underline.</p>
            </div>
            <div>
              <label className="label-mono block mb-1.5">Senha</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" placeholder="Crie uma senha com 8 caracteres ou mais" className="field w-full text-foreground" required minLength={8} maxLength={128} />
            </div>
            <div>
              <label className="label-mono block mb-1.5">CNPJ</label>
              <input value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} inputMode="numeric" autoComplete="off" placeholder="00.000.000/0000-00" className="field w-full text-foreground" required />
            </div>
            <div>
              <label className="label-mono block mb-1.5">Número de telefone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" className="field w-full text-foreground" required />
            </div>
            <div>
              <label className="label-mono block mb-1.5">E-mail</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="empresa@email.com" className="field w-full text-foreground" required maxLength={254} />
            </div>

            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">MobFlow Completo</p>
                  <p className="mt-1 text-xs text-muted-foreground">Todas as funcionalidades em um único plano.</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xl font-bold text-foreground">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(signupAmount)}</p>
                  <p className="text-xs text-muted-foreground">por mês</p>
                </div>
              </div>
              <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <li>✓ PDV, produtos, códigos de barras e estoque</li>
                <li>✓ Recebimento, conferência e validade</li>
                <li>✓ Clientes, fiado e relatórios de vendas</li>
                <li>✓ Controle de lucro e dados separados por empresa</li>
              </ul>
            </div>

            <div className="space-y-2">
              <label className="label-mono block">FORMA DE PAGAMENTO</label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-primary bg-primary/5 p-3">
                <input type="radio" name="signup-payment-method" value="pix" checked readOnly className="mt-1 h-4 w-4 accent-primary" />
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-500/10 font-bold text-emerald-600">Pix</span>
                <span className="flex-1">
                  <span className="block font-semibold text-foreground">Pix</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">Pagamento conferido manualmente pelo administrador.</span>
                </span>
                <span className="text-xs font-semibold text-primary">Selecionado</span>
              </label>
            </div>

            {error && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{error}</div>}
            <button type="submit" disabled={loading} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground hover:bg-primary/85 transition-colors disabled:opacity-50">
              {loading ? "Criando conta..." : "Criar conta"}
            </button>
            <p className="text-center text-xs text-muted-foreground">O acesso será liberado após a confirmação do pagamento e ativação da assinatura.</p>
            <button type="button" onClick={() => { setCreatingAccount(false); setError(""); }} className="w-full rounded-xl border border-border bg-transparent py-3 font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              Voltar para login
            </button>
          </form>
        )}

        {mode === "empresa" && !creatingAccount && !signupComplete && (
          <button type="button" onClick={async () => { setCreatingAccount(true); setError(""); setSignupSuccess(""); setSignupPayment(null); const { data } = await supabase.functions.invoke("mobflow-signup", { body: { action: "payment_info" } }); if (data?.ok) setSignupAmount(Number(data.amount) || 79.90); }} className="mt-3 w-full rounded-xl border border-border bg-transparent py-3 font-semibold text-foreground transition-colors hover:bg-accent">
            Criar conta
          </button>
        )}

        <p className="mt-5 text-center font-mono text-[10px] text-muted-foreground">Acesso restrito · informe as credenciais cadastradas</p>
        {mode === "admin" && (
          <div className="mt-3 text-center">
            <a href="/" className="inline-flex w-full items-center justify-center rounded-xl border border-border bg-transparent py-3 font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              Voltar ao login da empresa
            </a>
          </div>
        )}

        {mode === "empresa" && (
          <div className="mt-2 text-center">
            <a href="/?admin=1" className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground">
              Administração
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
