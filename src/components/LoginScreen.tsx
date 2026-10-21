import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import { ArrowLeft, CheckCircle2, Copy, LogOut } from "lucide-react";

const AUTH_KEY = "mobflow-authenticated";
const REMEMBER_KEY = "mobflow-remember-login";
const PENDING_PAYMENT_KEY = "mobflow-pending-payment";

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
    fetch("https://xsitutjpdshmidzpgxpx.supabase.co/functions/v1/mobflow-public-billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Configuração indisponível")))
      .then((settings) => {
        const price = Number(settings?.monthly_price);
        if (!cancelled && settings?.ok === true && Number.isFinite(price) && price > 0) setSignupMonthlyPrice(price);
      })
      .catch(() => { if (!cancelled) setSignupMonthlyPrice(null); });
    return () => { cancelled = true; };
  }, [mode, showSignup, signupResult]);

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
        let serverMessage = String(data?.error || "");
        if (error && !serverMessage && error.context && typeof error.context.clone === "function") {
          try { const detail = await error.context.clone().json(); serverMessage = String(detail?.error || ""); } catch { /* mantém mensagem genérica */ }
        }
        if (mode === "empresa") {
          const saved = savedPendingPayment;
          const enteredUsername = username.trim().toUpperCase();
          const enteredCnpj = cnpj.replace(/\D/g, "");
          if (saved && saved.username === enteredUsername && saved.cnpj === enteredCnpj && saved.amount && saved.pixCopyPaste && saved.pixQrCode) {
            setPendingPayment(saved);
            setError("");
            return;
          }
          if (/aguarda confirmação e ativação|assinatura ainda aguarda confirmação|pagamento pendente/i.test(serverMessage)) {
            setError("Pagamento pendente. Se você fez o cadastro neste dispositivo, informe o mesmo usuário e CNPJ para abrir o Pix.");
            return;
          }
        }
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

  const submitSignup = async (e: FormEvent) => {
    e.preventDefault();
    setSignupLoading(true);
    setSignupError("");
    try {
      const { data, error } = await supabase.functions.invoke("mobflow-signup", {
        body: {
          companyName: signupForm.companyName.trim(),
          username: signupForm.username.trim().toUpperCase(),
          password: signupForm.password,
          cnpj: signupForm.cnpj,
          email: signupForm.email.trim().toLowerCase(),
          phone: signupForm.phone,
        },
      });
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
    <div className="grid min-h-[100dvh] place-items-center bg-[#0b1726] px-4 py-6">
      <style>{`@keyframes mobflowLoginReveal { 0% { opacity: 0; transform: translateX(26px) scale(.975); filter: blur(7px); } 65% { opacity: 1; filter: blur(0); } 100% { opacity: 1; transform: translateX(0) scale(1); filter: blur(0); } } @media (prefers-reduced-motion: reduce) { .mobflow-login-reveal { animation: none !important; } }`}</style>
      <div className={`mobflow-login-reveal relative w-full rounded-2xl border border-white/10 bg-[#14263a] p-6 shadow-2xl shadow-black/30 sm:p-8 ${mode === "empresa" ? "max-w-md lg:max-w-2xl lg:p-12 xl:max-w-3xl" : "max-w-md"}`} style={{ animation: "mobflowLoginReveal 850ms cubic-bezier(0.22, 1, 0.36, 1) both" }}>
        {mode === "pdv" && !onClose && (
          <button type="button" onClick={() => setShowAccountLogoutConfirm(true)} className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#20364b] px-2.5 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-[#1b3048] hover:text-white" aria-label="Sair da conta" title="Sair da conta">
            <LogOut className="h-4 w-4" /><span>Sair da conta</span>
          </button>
        )}
        {mode === "pdv" && onClose && <button type="button" onClick={onClose} aria-label="Fechar login do PDV" title="Fechar" className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-[#1b3048] hover:text-white"><span aria-hidden="true" className="text-2xl leading-none">×</span></button>}
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
        <div className={`mx-auto w-full rounded-xl bg-[#f8fafc] px-3 py-2.5 text-center shadow-sm ${mode === "empresa" ? "max-w-[320px] lg:max-w-[420px]" : "max-w-[320px]"}`}>
          <img src="/mobflow-logo.svg" alt="MobFlow — PDV e estoque" className={`mx-auto block h-auto w-full object-contain ${mode === "empresa" ? "max-w-[280px] lg:max-w-[380px]" : "max-w-[280px]"}`} />
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
            <h2 className="mt-4 font-display text-2xl tracking-[.06em] text-white">{companySettings.companyName || "Sua empresa"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Acesso de usuário</p>
          </div>
        )}

        <div className="mt-8 text-center">
          <h1 className={`font-display tracking-[.1em] text-white ${mode === "empresa" ? "text-xl lg:text-3xl" : "text-xl"}`}>{mode === "pdv" ? "LOGIN DO USUÁRIO" : "LOGIN DA EMPRESA"}</h1>
          <p className={`mt-1 text-slate-400 ${mode === "empresa" ? "text-sm lg:text-base" : "text-sm"}`}>{mode === "pdv" ? "Informe seu usuário e senha para continuar." : "Informe os dados da empresa para entrar."}</p>
        </div>

        <form onSubmit={submit} className={`mt-5 space-y-4 ${mode === "empresa" ? "lg:mt-8 lg:space-y-5" : ""}`} autoComplete="off">
          <div>
            <label className="label-mono mb-1.5 block !text-slate-400">Usuário</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete={mode === "pdv" ? "new-password" : "off"} name={mode === "pdv" ? "operator-login-field" : "company-login"} placeholder="Nome de usuário" className="field w-full !border-white/10 !bg-[#20364b] !text-slate-100 placeholder:!text-slate-400 focus:!border-primary" autoFocus />
          </div>

          <div>
            <label className="label-mono block mb-1.5">Senha</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete={mode === "pdv" ? "new-password" : "current-password"} name={mode === "pdv" ? "operator-password-field" : "company-password"} placeholder="Senha" className="field w-full !border-white/10 !bg-[#20364b] !text-slate-100 placeholder:!text-slate-400 focus:!border-primary" />
          </div>

          {error && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{error}</div>}

          {mode !== "pdv" && (
            <div>
              <label className="label-mono block mb-1.5">CNPJ</label>
              <input value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} inputMode="numeric" autoComplete="organization" placeholder="00.000.000/0000-00" className="field w-full text-foreground" required />
            </div>
          )}

          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={mode === "pdv" ? false : rememberLogin} disabled={mode === "pdv"} onChange={(e) => setRememberLogin(e.target.checked)} className="h-4 w-4 accent-primary" />
            <span>Salvar login</span>
          </label>

          <button type="submit" disabled={loading} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground hover:bg-primary/85 transition-colors disabled:opacity-50">
            {loading ? "Validando..." : "Entrar"}
          </button>
          {mode === "empresa" && !onClose && (
            <>
              <button type="button" onClick={() => { setShowSignup(true); setSignupError(""); }} className="w-full rounded-xl border border-white/15 bg-transparent py-3.5 font-bold text-slate-100 transition-colors hover:bg-white/5">
                Criar conta
              </button>
              <a href="/saiba-mais" className="inline-flex w-full items-center justify-center rounded-xl border border-primary/40 bg-primary/10 py-3.5 font-bold text-primary transition-colors hover:bg-primary/20">
                Saiba mais sobre o MobFlow
              </a>
            </>
          )}
          {mode === "pdv" && onClose && (
            <button type="button" onClick={onClose} className="w-full rounded-xl border border-white/15 bg-transparent py-3 font-semibold text-slate-300 transition-colors hover:bg-white/5 hover:text-white">
              Cancelar
            </button>
          )}
        </form>

        <p className="mt-5 text-center font-mono text-[10px] text-slate-500">Acesso restrito · informe as credenciais cadastradas</p>



      </div>
    </div>
  );
}
