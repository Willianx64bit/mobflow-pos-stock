import { FormEvent, useEffect, useState } from "react";
import { mobflowAuthClient } from "@/lib/auth-client";
import { useStore } from "@/lib/store";
import { ArrowLeft, CheckCircle2, Copy, LogOut } from "lucide-react";

const AUTH_KEY = "mobflow-authenticated";
const REMEMBER_KEY = "mobflow-remember-login";
const PENDING_PAYMENT_KEY = "mobflow-pending-payment";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("LOGIN_TIMEOUT")), ms);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

export function isAuthenticated() {
  return localStorage.getItem(AUTH_KEY) === "1";
}

export async function logout() {
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem("mobflow-role");
  sessionStorage.removeItem("mobflow-username");
  sessionStorage.removeItem("mobflow-management");
  sessionStorage.removeItem("mobflow-pdv-authorized");
  await mobflowAuthClient.signOut().catch(() => undefined);
}

export function LoginScreen({ onLogin, onClose, mode = "empresa" }: { onLogin: (options?: { firstManagerLogin?: boolean }) => void; onClose?: () => void; mode?: "empresa" | "pdv" }) {
  const companySettings = useStore((s) => s.settings);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Deixa o campo vazio para o navegador oferecer o CNPJ salvo ao tocar nele.
  const [cnpj, setCnpj] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(() => localStorage.getItem(REMEMBER_KEY) === "1");
  const [showAccountLogoutConfirm, setShowAccountLogoutConfirm] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [signupResult, setSignupResult] = useState<{
    amount: number; pixCopyPaste: string; pixQrCode: string; pixRecipientName: string; username: string; requestToken?: string;
  } | null>(null);
  const [signupCopied, setSignupCopied] = useState(false);
  const [signupMonthlyPrice, setSignupMonthlyPrice] = useState<number | null>(null);
  const [pendingPayment, setPendingPayment] = useState<any>(null);
  const [savedPendingPayment, setSavedPendingPayment] = useState<any>(() => {
    try { return JSON.parse(localStorage.getItem(PENDING_PAYMENT_KEY) || "null"); } catch { return null; }
  });
  const [signupForm, setSignupForm] = useState({
    companyName: "", username: "", password: "", cnpj: "", email: "", phone: "",
  });

  useEffect(() => {
    if (mode !== "empresa" || !showSignup || signupResult) return;
    let cancelled = false;
    fetch("/api/mobflow/signup", { method: "GET", credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Configuração indisponível")))
      .then((settings) => {
        const price = Number(settings?.monthly_price);
        if (!cancelled && settings?.ok === true && Number.isFinite(price) && price > 0) setSignupMonthlyPrice(price);
      })
      .catch(() => { if (!cancelled) setSignupMonthlyPrice(null); });
    return () => { cancelled = true; };
  }, [mode, showSignup, signupResult]);

  // Ao alternar entre login da empresa e do usuário, limpa as credenciais,
  // mas preserva a preferência "Salvar login" para ambos os acessos.
  useEffect(() => {
    setUsername("");
    setPassword("");
    setError("");
    setRememberLogin(localStorage.getItem(REMEMBER_KEY) === "1");
  }, [mode]);

  const logoutAccount = async () => {
    await mobflowAuthClient.signOut().catch(() => undefined);
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
        if (loginCnpj.length !== 14) {
          setError("Não foi possível identificar a empresa. Entre novamente na gerência.");
          return;
        }
      }

      {
        await mobflowAuthClient.signOut().catch(() => undefined);
        sessionStorage.removeItem("mobflow-management");
        sessionStorage.removeItem("mobflow-pdv-authorized");
        sessionStorage.removeItem("mobflow-role");
        sessionStorage.removeItem("mobflow-username");

        const validationResponse = await withTimeout(fetch("/api/mobflow/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            username: username.trim(),
            password,
            cnpj: loginCnpj,
            expectedRole: mode === "pdv" ? "pdv" : "manager",
          }),
        }), 20000);
        const validation = await validationResponse.json().catch(() => ({}));
        if (!validationResponse.ok || !validation?.ok || !validation?.profile) {
          setError(String(validation?.error || "Usuário ou senha inválido."));
          return;
        }

        const email = username.trim().toUpperCase().toLowerCase().replace(/[^a-z0-9._-]/g, "-") + "@accounts.mobflow.local";
        const authResult = await withTimeout(
          mobflowAuthClient.signIn.email({ email, password }),
          15000,
        );
        if (authResult.error) {
          await mobflowAuthClient.signOut().catch(() => undefined);
          setError("Usuário ou senha inválido.");
          return;
        }

        localStorage.setItem(AUTH_KEY, "1");
        if (mode === "empresa") localStorage.setItem("mobflow-company-cnpj", loginCnpj);
        if (mode === "pdv") sessionStorage.setItem("mobflow-pdv-authorized", "1");
        sessionStorage.setItem("mobflow-role", validation.profile.role);
        sessionStorage.setItem("mobflow-username", validation.profile.username);
        const savedPermissions = Array.isArray(validation.profile.permissions)
          ? validation.profile.permissions
          : (validation.profile.role === "manager" ? ["PDV", "Conferência", "Validade", "Fiado", "Gerência"] : ["PDV", "Conferência"]);
        const normalizedPermissions = Array.from(new Set(savedPermissions.map((p: string) => p === "Conferência" ? "Operações" : p)));
        sessionStorage.setItem("mobflow-permissions", JSON.stringify(normalizedPermissions));
        const firstManagerLogin = mode === "empresa" && validation.firstManagerLogin === true;
        if (firstManagerLogin) sessionStorage.setItem("mobflow-first-manager-setup", "1");
        onLogin({ firstManagerLogin });
        return;
      }


    } catch (err) {
      setError(err instanceof Error && err.message === "LOGIN_TIMEOUT"
        ? "O servidor está demorando para responder. Tente novamente em instantes."
        : "Não foi possível conectar ao servidor.");
    } finally {
      setLoading(false);
    }
  };

  const submitSignup = async (e: FormEvent) => {
    e.preventDefault();
    setSignupLoading(true);
    setSignupError("");
    try {
      const signupBody = {
        companyName: signupForm.companyName.trim(),
        username: signupForm.username.trim().toUpperCase(),
        password: signupForm.password,
        cnpj: signupForm.cnpj,
        email: signupForm.email.trim().toLowerCase(),
        phone: signupForm.phone,
      };
      const response = await withTimeout(fetch("/api/mobflow/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(signupBody),
      }), 20000);
      const data = await response.json().catch(() => ({}));
      const error = response.ok ? null : { message: data?.error };
      if (error || !data?.ok) {
        let message = data?.error || error?.message || "Não foi possível concluir o cadastro.";
        if (error && !data?.error && error.context && typeof error.context.json === "function") {
          try { const detail = await error.context.json(); if (detail?.error) message = detail.error; } catch { /* mantém a mensagem padrão */ }
        }
        throw new Error(message);
      }
      setSignupResult({
        amount: Number(data.amount),
        pixCopyPaste: String(data.pixCopyPaste),
        pixQrCode: String(data.pixQrCode),
        pixRecipientName: String(data.pixRecipientName || "MOBFLOW"),
        username: String(data.username || signupForm.username.toUpperCase()),
        requestToken: String(data.requestToken || ""),
      });
      const pending = {
        amount: Number(data.amount), pixCopyPaste: String(data.pixCopyPaste), pixQrCode: String(data.pixQrCode),
        pixRecipientName: String(data.pixRecipientName || "MOBFLOW"),
        username: String(data.username || signupForm.username.toUpperCase()),
        requestToken: String(data.requestToken || ""), cnpj: signupForm.cnpj.replace(/\D/g, ""),
        email: signupForm.email.trim().toLowerCase(),
      };
      localStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(pending));
      setSavedPendingPayment(pending);
    } catch (err) {
      setSignupError(err instanceof Error ? err.message : "Não foi possível conectar ao servidor.");
    } finally {
      setSignupLoading(false);
    }
  };

  const copyPixCode = async () => {
    if (!signupResult) return;
    try {
      await navigator.clipboard.writeText(signupResult.pixCopyPaste);
      setSignupCopied(true);
    } catch {
      setSignupError("Não foi possível copiar automaticamente. Selecione e copie o código Pix.");
    }
  };


  if (mode === "empresa" && pendingPayment) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-background px-4 py-6">
        <div className="mfb-in w-full max-w-md rounded-2xl bg-surface ring-1 ring-border p-6 sm:p-8">
          <img src="/mobflow-logo.svg" alt="MobFlow" className="mx-auto mb-6 block h-auto w-full max-w-[240px] object-contain" />
          <div className="text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary"><CheckCircle2 className="h-7 w-7" /></div>
            <h1 className="mt-4 font-display text-xl tracking-[.08em] text-heading">PAGAMENTO PENDENTE</h1>
            <p className="mt-2 text-sm text-muted-foreground">A conta <strong>{pendingPayment.username}</strong> aguarda a confirmação do Pix para liberar o acesso.</p>
            <p className="mt-3 text-lg font-bold text-foreground">{pendingPayment.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
          </div>
          <div className="mt-5 rounded-xl border border-border bg-background p-4 text-center">
            <p className="mb-3 text-sm font-semibold">Pague com Pix para {pendingPayment.pixRecipientName}</p>
            <img src={pendingPayment.pixQrCode} alt="QR Code Pix da mensalidade" className="mx-auto h-56 w-56 max-w-full rounded-lg bg-white p-2" />
            <label className="mt-3 block text-left text-xs font-semibold text-muted-foreground">Pix copia e cola</label>
            <textarea readOnly value={pendingPayment.pixCopyPaste} rows={4} className="field mt-1 w-full resize-y text-xs text-foreground" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(pendingPayment.pixCopyPaste); setSignupCopied(true); } catch { setSignupError("Selecione e copie o código Pix manualmente."); } }} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-bold text-primary-foreground hover:bg-primary/85"><Copy className="h-4 w-4" /> {signupCopied ? "Código Pix copiado" : "Copiar código Pix"}</button>
          </div>
          <p className="mt-4 rounded-lg bg-secondary p-3 text-sm text-muted-foreground">Depois de pagar, aguarde a confirmação manual do administrador. Não é necessário criar outra conta.</p>
          {signupError && <p className="mt-3 text-sm text-destructive">{signupError}</p>}
          <button type="button" onClick={() => { setPendingPayment(null); setPassword(""); setError(""); setSignupCopied(false); }} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 font-semibold text-muted-foreground hover:bg-accent"><ArrowLeft className="h-4 w-4" /> Voltar ao login</button>
        </div>
      </div>
    );
  }

  if (mode === "empresa" && showSignup && signupResult) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-background px-4 py-6">
        <div className="mfb-in w-full max-w-md rounded-2xl bg-surface ring-1 ring-border p-6 sm:p-8">
          <img src="/mobflow-logo.svg" alt="MobFlow" className="mx-auto mb-6 block h-auto w-full max-w-[240px] object-contain" />
          <div className="text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-secondary text-primary"><CheckCircle2 className="h-7 w-7" /></div>
            <h1 className="mt-4 font-display text-xl tracking-[.08em] text-heading">CADASTRO RECEBIDO</h1>
            <p className="mt-2 text-sm text-muted-foreground">Usuário gerente: <strong>{signupResult.username}</strong></p>
            <p className="mt-3 text-sm text-muted-foreground">Mensalidade: <strong className="text-foreground">{signupResult.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong></p>
          </div>
          <div className="mt-5 rounded-xl border border-border bg-background p-4 text-center">
            <p className="mb-3 text-sm font-semibold">Pague com Pix para {signupResult.pixRecipientName}</p>
            <img src={signupResult.pixQrCode} alt="QR Code Pix da mensalidade" className="mx-auto h-56 w-56 max-w-full rounded-lg bg-white p-2" />
            <label className="mt-3 block text-left text-xs font-semibold text-muted-foreground">Pix copia e cola</label>
            <textarea readOnly value={signupResult.pixCopyPaste} rows={4} className="field mt-1 w-full resize-y text-xs text-foreground" onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={copyPixCode} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-bold text-primary-foreground hover:bg-primary/85">
              <Copy className="h-4 w-4" /> {signupCopied ? "Código Pix copiado" : "Copiar código Pix"}
            </button>
          </div>
          <div className="mt-4 rounded-lg bg-secondary p-3 text-sm text-muted-foreground">
            Seu acesso ficará pendente até o administrador confirmar o recebimento do Pix. Guarde o usuário e a senha cadastrados.
          </div>
          {signupError && <p className="mt-3 text-sm text-destructive">{signupError}</p>}
          <button type="button" onClick={() => { setShowSignup(false); setSignupResult(null); setSignupCopied(false); setUsername(signupResult.username); setCnpj(formatCnpj(signupForm.cnpj)); setSignupForm({ companyName: "", username: "", password: "", cnpj: "", email: "", phone: "" }); }} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border py-3 font-semibold text-muted-foreground hover:bg-accent">
            <ArrowLeft className="h-4 w-4" /> Voltar ao login
          </button>
        </div>
      </div>
    );
  }

  if (mode === "empresa" && showSignup) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-background px-4 py-6">
        <div className="mfb-in w-full max-w-md rounded-2xl bg-surface ring-1 ring-border p-6 sm:p-8">
          <img src="/mobflow-logo.svg" alt="MobFlow" className="mx-auto mb-6 block h-auto w-full max-w-[240px] object-contain" />
          <button type="button" onClick={() => { setShowSignup(false); setSignupError(""); }} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Voltar ao login</button>
          <h1 className="font-display text-xl tracking-[.08em] text-heading">CRIAR CONTA</h1>
          <p className="mt-1 text-sm text-muted-foreground">Preencha os dados da empresa para gerar a cobrança Pix.</p>
          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/10 p-4"><p className="text-xs font-semibold uppercase tracking-[.12em] text-primary">Mensalidade do MobFlow</p><div className="mt-1 flex items-baseline gap-2"><span className="text-3xl font-black text-foreground">{signupMonthlyPrice === null ? "Consultar valor" : signupMonthlyPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>{signupMonthlyPrice !== null && <span className="text-sm text-muted-foreground">/ mês</span>}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">O pagamento inicial é feito por Pix e o acesso é liberado após a confirmação do administrador.</p></div>
          <form onSubmit={submitSignup} className="mt-5 space-y-3" autoComplete="off">
            <div><label className="label-mono mb-1 block">Nome da empresa</label><input required minLength={2} maxLength={120} value={signupForm.companyName} onChange={(e) => setSignupForm({ ...signupForm, companyName: e.target.value })} className="field w-full text-foreground" placeholder="Nome da empresa" /></div>
            <div><label className="label-mono mb-1 block">Usuário do gerente</label><input required minLength={3} maxLength={40} pattern="[A-Za-z0-9._-]+" value={signupForm.username} onChange={(e) => setSignupForm({ ...signupForm, username: e.target.value.toUpperCase() })} className="field w-full text-foreground" placeholder="Ex.: MERCADO01" /></div>
            <div><label className="label-mono mb-1 block">Senha (mínimo 8 caracteres)</label><input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={signupForm.password} onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })} className="field w-full text-foreground" placeholder="Crie uma senha" /></div>
            <div><label className="label-mono mb-1 block">CNPJ</label><input required inputMode="numeric" value={signupForm.cnpj} onChange={(e) => setSignupForm({ ...signupForm, cnpj: formatCnpj(e.target.value) })} className="field w-full text-foreground" placeholder="00.000.000/0000-00" /></div>
            <div><label className="label-mono mb-1 block">E-mail</label><input required type="email" maxLength={254} autoComplete="email" value={signupForm.email} onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })} className="field w-full text-foreground" placeholder="email@empresa.com" /></div>
            <div><label className="label-mono mb-1 block">Telefone com DDD</label><input required type="tel" inputMode="tel" value={signupForm.phone} onChange={(e) => setSignupForm({ ...signupForm, phone: e.target.value })} className="field w-full text-foreground" placeholder="(15) 99999-9999" /></div>
            {signupError && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{signupError}</div>}
            <button type="submit" disabled={signupLoading} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground hover:bg-primary/85 disabled:opacity-50">{signupLoading ? "Criando cadastro..." : "Criar conta e gerar Pix"}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background px-4 py-8 text-foreground md:px-8 md:py-10">
      <style>{`input.field, input.field[type="password"], input.field[type="text"] { background-color: #fff !important; color: #0f172a !important; -webkit-text-fill-color: #0f172a !important; color-scheme: light; } input.field:-webkit-autofill, input.field:-webkit-autofill:hover, input.field:-webkit-autofill:focus, input.field:-webkit-autofill:active { -webkit-text-fill-color: #0f172a !important; -webkit-box-shadow: 0 0 0 1000px #fff inset !important; box-shadow: 0 0 0 1000px #fff inset !important; background-color: #fff !important; caret-color: #0f172a !important; color-scheme: light; } @keyframes mobflowLoginReveal { 0% { opacity: 0; transform: translateX(26px) scale(.975); filter: blur(7px); } 65% { opacity: 1; filter: blur(0); } 100% { opacity: 1; transform: translateX(0) scale(1); filter: blur(0); } } @media (prefers-reduced-motion: reduce) { .mobflow-login-reveal { animation: none !important; } }`}</style>
      <div className={`mobflow-login-reveal relative w-full rounded-2xl border border-border bg-surface p-6 text-foreground shadow-xl shadow-black/10 sm:p-8 ${mode === "empresa" ? "max-w-xl lg:max-w-3xl lg:p-12" : "max-w-xl lg:max-w-2xl lg:p-12"}`} style={{ animation: "mobflowLoginReveal 850ms cubic-bezier(0.22, 1, 0.36, 1) both" }}>
        {mode === "pdv" && !onClose && (
          <button type="button" onClick={() => setShowAccountLogoutConfirm(true)} className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900" aria-label="Sair da conta" title="Sair da conta">
            <LogOut className="h-4 w-4" /><span>Sair da conta</span>
          </button>
        )}
        {mode === "pdv" && onClose && <button type="button" onClick={onClose} aria-label="Fechar login do PDV" title="Fechar" className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"><span aria-hidden="true" className="text-2xl leading-none">×</span></button>}
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
        <div className={`mx-auto w-full rounded-xl bg-white px-3 py-2.5 text-center ${mode === "empresa" ? "max-w-[360px] lg:max-w-[520px]" : "max-w-[360px] lg:max-w-[480px]"}`}>
          <img src="/mobflow-logo.svg" alt="MobFlow — PDV e estoque" className={`mx-auto block h-auto w-full object-contain ${mode === "empresa" ? "max-w-[320px] lg:max-w-[480px]" : "max-w-[320px] lg:max-w-[440px]"}`} />
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
            <h2 className="mt-4 font-display text-2xl lg:text-3xl tracking-[.06em] text-slate-900">{companySettings.companyName || "Sua empresa"}</h2>
            <p className="mt-1 text-sm lg:text-base text-slate-500">Acesso de usuário</p>
          </div>
        )}

        <div className="mt-8 text-center">
          <h1 className={`font-display tracking-[.1em] text-heading ${mode === "empresa" ? "text-2xl lg:text-4xl" : "text-2xl lg:text-4xl"}`}>{mode === "pdv" ? "LOGIN DO USUÁRIO" : "LOGIN DA EMPRESA"}</h1>
          <p className={`mt-1 text-muted-foreground ${mode === "empresa" ? "text-base lg:text-lg" : "text-base lg:text-lg"}`}>{mode === "pdv" ? "Informe seu usuário e senha para continuar." : "Informe os dados da empresa para entrar."}</p>
        </div>

        <form onSubmit={submit} className={`mt-5 space-y-4 ${mode === "empresa" ? "lg:mt-8 lg:space-y-5" : ""}`} autoComplete="on">
          <div>
            <label className="label-mono mb-1.5 block !text-muted-foreground">Usuário</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete={mode === "pdv" ? "new-password" : "off"} name={mode === "pdv" ? "operator-login-field" : "company-login"} placeholder="Nome de usuário" className="field w-full border border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary lg:py-3.5 lg:text-base" autoFocus />
          </div>

          <div>
            <label className="label-mono block mb-1.5 !text-slate-600">Senha</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete={mode === "pdv" ? "new-password" : "current-password"} name={mode === "pdv" ? "operator-password-field" : "company-password"} placeholder="Senha" className="field w-full !border-slate-300 !bg-white !text-slate-900 placeholder:!text-slate-400 focus:!border-primary lg:py-3.5 lg:text-base" />
          </div>

          {error && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{error}</div>}

          {mode !== "pdv" && (
            <div>
              <label className="label-mono block mb-1.5">CNPJ</label>
              <input value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} inputMode="numeric" autoComplete="on" name="cnpj" placeholder="00.000.000/0000-00" className="field w-full border border-border bg-background text-foreground focus-visible:ring-2 focus-visible:ring-primary lg:py-3.5 lg:text-base" required />
            </div>
          )}

          <label className="flex cursor-pointer select-none items-center gap-2 text-sm lg:text-base text-muted-foreground">
            <input type="checkbox" checked={rememberLogin} onChange={(e) => { setRememberLogin(e.target.checked); localStorage.setItem(REMEMBER_KEY, e.target.checked ? "1" : "0"); }} className="h-4 w-4 accent-primary" />
            <span>Salvar login</span>
          </label>

          <button type="submit" disabled={loading} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground hover:bg-primary/85 transition-colors disabled:opacity-50">
            {loading ? "Validando..." : "Entrar"}
          </button>
          {mode === "empresa" && !onClose && (
            <>
              <button type="button" onClick={() => { setShowSignup(true); setSignupError(""); }} className="w-full rounded-xl border border-slate-300 bg-white py-3.5 lg:py-4 font-bold text-slate-700 transition-colors hover:bg-slate-50">
                Criar conta
              </button>
              <a href="/saiba-mais" className="inline-flex w-full items-center justify-center rounded-xl border border-primary/40 bg-primary/10 py-3.5 font-bold text-primary transition-colors hover:bg-primary/20">
                Saiba mais sobre o MobFlow
              </a>
            </>
          )}
          {mode === "pdv" && onClose && (
            <button type="button" onClick={onClose} className="w-full rounded-xl border border-slate-300 bg-white py-3 font-semibold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900">
              Cancelar
            </button>
          )}
        </form>

        <p className="mt-6 text-center font-mono text-xs text-muted-foreground">Acesso restrito · informe as credenciais cadastradas</p>



      </div>
    </div>
  );
}
