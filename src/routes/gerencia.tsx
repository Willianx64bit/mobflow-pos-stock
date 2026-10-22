import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { AppHeader } from "@/components/AppHeader";
import { brl, useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { verifyManagerPassword } from "@/lib/manager-auth";
import { Settings, LockKeyhole, Package, ChartNoAxesCombined, Truck, Percent, Scale, Workflow } from "lucide-react";

const managementTabs = [
  { to: "/estoque", label: "Estoque", icon: "stock" },
  { to: "/operacoes", label: "Operações", icon: "operations" },
  { to: "/vendas", label: "Vendas", icon: "sales" },
  { to: "/recebimento", label: "Recebimento", icon: "receiving" },
  { to: "/configuracoes", label: "Configurações", icon: "settings" },
  { to: "/promocoes", label: "Promoções", icon: "promotions" },
] as const;

const localDateKey = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
};

function saleProfit(s: { total: number; profit?: number | undefined; items: { name: string; cost?: number | undefined; qty: number }[] }, products: { name: string; cost?: number | undefined }[]) {
  if (typeof s.profit === "number") return s.profit;
  const costTotal = s.items.reduce((sum, item) => {
    const product = products.find((p) => p.name === item.name);
    return sum + (item.cost ?? product?.cost ?? 0) * item.qty;
  }, 0);
  return s.total - costTotal;
}

export const Route = createFileRoute("/gerencia")({
  head: () => ({ meta: [{ title: "MobFlow — Gerência" }] }),
  component: Gerencia,
});

function Gerencia() {
  const navigate = useNavigate();
  const products = useStore((s) => s.products);
  const sales = useStore((s) => s.sales);
  const receiving = useStore((s) => s.receiving ?? []);
  const manualExpiries = useStore((s) => s.manualExpiries ?? []);
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("mobflow-management") === "1");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryCnpj, setRecoveryCnpj] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  useEffect(() => {
    const syncLock = () => setUnlocked(sessionStorage.getItem("mobflow-management") === "1");
    window.addEventListener("mobflow-management-changed", syncLock);
    return () => window.removeEventListener("mobflow-management-changed", syncLock);
  }, []);

  const lockManagement = () => {
    sessionStorage.removeItem("mobflow-management");
    setUnlocked(false);
    window.dispatchEvent(new Event("mobflow-management-changed"));
  };

  const requestManagerPasswordRecovery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRecoveryMessage("");
    const email = recoveryEmail.trim().toLowerCase();
    const cnpj = recoveryCnpj.replace(/\D/g, "");
    if (!email || !email.includes("@") || cnpj.length !== 14) {
      setRecoveryMessage("Informe um e-mail válido e o CNPJ completo da empresa.");
      return;
    }
    setRecoveryLoading(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("mobflow-manager-password-recovery", {
        body: { action: "request", email, cnpj },
      });
      if (invokeError || !data?.ok) {
        setRecoveryMessage(String(data?.error ?? "Não foi possível processar a solicitação agora. Tente novamente mais tarde."));
      } else {
        setRecoveryMessage(data.message || "Se os dados corresponderem à conta da Gerência, enviaremos um link para o e-mail cadastrado.");
      }
    } catch {
      setRecoveryMessage("Não foi possível conectar ao serviço de recuperação.");
    } finally {
      setRecoveryLoading(false);
    }
  };
  const [error, setError] = useState("");
  const [checkingManager, setCheckingManager] = useState(true);
  const [accessIssue, setAccessIssue] = useState("");
  const [managerPasswordConfigured, setManagerPasswordConfigured] = useState(true);
  const [setupPassword, setSetupPassword] = useState("");
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState("");
  const [setupPasswordError, setSetupPasswordError] = useState("");
  const [firstUserRequired, setFirstUserRequired] = useState(false);
  const [firstUsername, setFirstUsername] = useState("");
  const [firstDisplayName, setFirstDisplayName] = useState("");
  const [firstPassword, setFirstPassword] = useState("");
  const [firstPasswordConfirm, setFirstPasswordConfirm] = useState("");
  const [firstUserError, setFirstUserError] = useState("");
  const [firstUserLoading, setFirstUserLoading] = useState(false);

  const today = localDateKey();
  const todays = sales.filter((s) => localDateKey(new Date(s.date)) === today);
  const todaySales = todays.reduce((sum, s) => sum + s.total, 0);
  const todayProfit = todays.reduce((sum, s) => sum + saleProfit(s, products), 0);
  const low = products.filter((p) => p.stock <= p.minStock).sort((a, b) => a.stock - b.stock).slice(0, 6);

  const expiryItems = useMemo(() => {
    const fromNotes = receiving
      .filter((note) => note.source !== "manual")
      .flatMap((note) => note.items
        .filter((item) => !!item.expiry)
        .map((item) => ({
          id: note.id + "-" + item.productId + "-" + item.expiry,
          name: item.name,
          quantity: item.received ?? item.expected ?? 0,
          expiry: item.expiry!,
          unit: item.unit,
        })));
    const manual = manualExpiries.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      expiry: item.expiry,
      unit: item.unit,
    }));
    const parseExpiry = (value: string) => {
      const [day, month, year] = value.split("/").map(Number);
      return new Date(year, month - 1, day).getTime();
    };
    return [...fromNotes, ...manual]
      .sort((a, b) => parseExpiry(a.expiry) - parseExpiry(b.expiry))
      .slice(0, 5);
  }, [receiving, manualExpiries]);


  useEffect(() => {
    let active = true;
    const checkManager = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          if (active) {
            setAccessIssue("Sua sessão não está ativa. Entre novamente com a conta da empresa para acessar a Gerência.");
            setCheckingManager(false);
          }
          return;
        }
        const { data: securityStatus, error: securityStatusError } = await supabase.functions.invoke("mobflow-reauth-manager", { body: { action: "status" } });
        if (securityStatusError || typeof securityStatus?.configured !== "boolean" || !["manager", "pdv"].includes(securityStatus?.role)) {
          throw new Error("Não foi possível verificar a permissão da Gerência.");
        }
        let needsFirstUser = false;
        if (securityStatus.role === "manager" && securityStatus.configured) {
          const { data: usersData, error: usersError } = await supabase.functions.invoke("mobflow-users", { body: { action: "list" } });
          if (usersError || !Array.isArray(usersData?.users)) throw new Error("Não foi possível verificar o primeiro usuário.");
          needsFirstUser = usersData.users.length === 0;
        }
        if (active) {
          setManagerPasswordConfigured(securityStatus.configured);
          setFirstUserRequired(needsFirstUser);
          setAccessIssue("");
          setCheckingManager(false);
        }
      } catch {
        if (active) {
          setAccessIssue("Não foi possível confirmar a permissão da sua conta. Verifique a conexão e tente novamente.");
          setCheckingManager(false);
        }
      }
    };
    void checkManager();
    return () => { active = false; };
  }, []);

  const createManagerPassword = async () => {
    setSetupPasswordError("");
    if (setupPassword.length < 8) {
      setSetupPasswordError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (setupPassword !== setupPasswordConfirm) {
      setSetupPasswordError("As senhas não conferem.");
      return;
    }
    setPasswordLoading(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("mobflow-reauth-manager", {
        body: { action: "set_password", password: setupPassword },
      });
      if (invokeError || !data?.ok) {
        setSetupPasswordError(data?.error || "Não foi possível salvar a senha. Tente novamente.");
        return;
      }
      setManagerPasswordConfigured(true);
      setFirstUserRequired(false);
      sessionStorage.setItem("mobflow-management", "1");
      setUnlocked(true);
      setSetupPassword("");
      setSetupPasswordConfirm("");
      setPasswordError("");
      navigate({ to: "/configuracoes" });
    } catch {
      setSetupPasswordError("Não foi possível conectar ao servidor.");
    } finally {
      setPasswordLoading(false);
    }
  };

  const confirmManagerPassword = async () => {
    setPasswordError("");
    if (password.length < 6) {
      setPasswordError("Informe a senha da gerência.");
      return;
    }
    setPasswordLoading(true);
    const result = await verifyManagerPassword(password);
    setPasswordLoading(false);
    if (!result.ok) {
      setPasswordError(result.error || "Senha da gerência incorreta.");
      return;
    }
    sessionStorage.setItem("mobflow-management", "1");
    setUnlocked(true);
    setPassword("");
  };

  const confirmPromotionPassword = async () => {
    setPasswordError("");
    if (password.length < 6) {
      setPasswordError("Informe a senha da gerência.");
      return;
    }
    setPasswordLoading(true);
    const result = await verifyManagerPassword(password);
    setPasswordLoading(false);
    if (!result.ok) {
      setPasswordError(result.error || "Senha da gerência incorreta.");
      return;
    }
    setPassword("");
    setPasswordError("");
    setPromotionPasswordOpen(false);
    navigate({ to: "/promocoes" });
  };

  const [promotionPasswordOpen, setPromotionPasswordOpen] = useState(false);

  if (checkingManager) {
    return <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6"><AppHeader /><section className="min-h-[calc(100vh-7rem)] grid place-items-center"><div className="text-sm text-muted-foreground">Carregando gerência...</div></section></div>;
  }

  if (accessIssue) {
    return (
      <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
        <AppHeader />
        <section className="min-h-[calc(100vh-7rem)] grid place-items-center">
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 ring-1 ring-border sm:p-8">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-green-600/10 text-green-600 ring-1 ring-green-600/20"><LockKeyhole className="h-6 w-6" /></div>
            <h1 className="mt-4 text-center font-display text-2xl text-heading">Acesso à Gerência</h1>
            <p className="mt-3 text-center text-sm leading-6 text-muted-foreground">{accessIssue}</p>
            <div className="mt-6 grid gap-2">
              <button type="button" onClick={() => navigate({ to: "/" })} className="w-full rounded-xl bg-secondary py-3 font-semibold text-secondary-foreground ring-1 ring-border">Voltar ao PDV</button>
              <button type="button" onClick={async () => {
                await supabase.auth.signOut();
                localStorage.removeItem("mobflow-authenticated");
                sessionStorage.removeItem("mobflow-role");
                sessionStorage.removeItem("mobflow-username");
                sessionStorage.removeItem("mobflow-pdv-authorized");
                sessionStorage.removeItem("mobflow-management");
                window.dispatchEvent(new Event("mobflow-auth-changed"));
                navigate({ to: "/" });
              }} className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground">Sair e entrar com a conta da empresa</button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!managerPasswordConfigured) {
    return (
      <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
        <AppHeader />
        <section className="min-h-[calc(100vh-7rem)] grid place-items-center">
          <div className="w-full max-w-md rounded-2xl bg-surface ring-1 ring-border p-6 sm:p-8">
            <div className="text-center">
              <img src="/mobflow-logo.svg" alt="MobFlow — PDV + Estoque" className="mx-auto block h-auto w-full max-w-[280px] object-contain" />
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">PRIMEIRO ACESSO · GERÊNCIA</div>
              <h1 className="mt-4 font-display text-2xl text-heading">Crie a senha da Gerência</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Defina uma senha exclusiva para proteger a Gerência desta empresa. Ela será diferente da senha usada no login da empresa.</p>
            </div>
            <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); void createManagerPassword(); }}>
              <input type="password" value={setupPassword} onChange={(e) => { setSetupPassword(e.target.value); setSetupPasswordError(""); }} placeholder="Nova senha (mínimo 8 caracteres)" autoComplete="new-password" className="field w-full text-foreground" autoFocus />
              <input type="password" value={setupPasswordConfirm} onChange={(e) => { setSetupPasswordConfirm(e.target.value); setSetupPasswordError(""); }} placeholder="Confirme a senha" autoComplete="new-password" className="field w-full text-foreground" />
              {setupPasswordError && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{setupPasswordError}</div>}
              <button type="submit" disabled={passwordLoading} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground disabled:opacity-50">{passwordLoading ? "Salvando..." : "Salvar senha da Gerência"}</button>
              <p className="text-center text-xs text-muted-foreground">A senha é vinculada somente a esta empresa e não pode ser redefinida por esta tela após o cadastro.</p>
            </form>
          </div>
        </section>
      </div>
    );
  }

  const createFirstUser = async () => {
    setFirstUserError("");
    const username = firstUsername.trim().toUpperCase();
    if (!/^[A-Z0-9._-]{3,40}$/.test(username)) {
      setFirstUserError("Use um usuário com 3 a 40 caracteres: letras, números, ponto, hífen ou underline.");
      return;
    }
    if (firstPassword.length < 6) {
      setFirstUserError("A senha do usuário precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (firstPassword !== firstPasswordConfirm) {
      setFirstUserError("As senhas do usuário não conferem.");
      return;
    }
    setFirstUserLoading(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("mobflow-users", {
        body: {
          action: "create",
          username,
          displayName: firstDisplayName.trim() || username,
          password: firstPassword,
          permissions: ["PDV", "Conferência", "Validade", "Fiado", "Gerência"],
        },
      });
      if (invokeError || !data?.ok) {
        let message = data?.error || "";
        try { message = message || String((await (invokeError as { context?: Response })?.context?.json())?.error || ""); } catch {}
        setFirstUserError(message || "Não foi possível cadastrar o primeiro usuário. Tente novamente.");
        return;
      }
      setFirstUserRequired(false);
      setFirstUsername("");
      setFirstDisplayName("");
      setFirstPassword("");
      setFirstPasswordConfirm("");
      sessionStorage.setItem("mobflow-management", "1");
      setUnlocked(true);
    } catch {
      setFirstUserError("Não foi possível conectar ao servidor. Seus dados da empresa foram preservados.");
    } finally {
      setFirstUserLoading(false);
    }
  };

  if (firstUserRequired && managerPasswordConfigured) {
    return (
      <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
        <AppHeader />
        <section className="min-h-[calc(100vh-7rem)] grid place-items-center">
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 ring-1 ring-border sm:p-8">
            <div className="text-center">
              <img src="/mobflow-logo.svg" alt="MobFlow — PDV + Estoque" className="mx-auto block h-auto w-full max-w-[280px] object-contain" />
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">PRIMEIRO ACESSO · USUÁRIO</div>
              <h1 className="mt-4 font-display text-2xl text-heading">Cadastre o primeiro usuário</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">A senha exclusiva da Gerência foi configurada. Agora crie o usuário que será usado para entrar no sistema. Os dados da empresa ficam preservados.</p>
            </div>
            <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); void createFirstUser(); }}>
              <input value={firstDisplayName} onChange={(e) => setFirstDisplayName(e.target.value)} placeholder="Nome da pessoa (opcional)" autoComplete="name" className="field w-full text-foreground" />
              <input value={firstUsername} onChange={(e) => { setFirstUsername(e.target.value); setFirstUserError(""); }} placeholder="Nome de usuário" autoComplete="username" className="field w-full text-foreground" autoFocus required />
              <input type="password" value={firstPassword} onChange={(e) => { setFirstPassword(e.target.value); setFirstUserError(""); }} placeholder="Senha do usuário (mínimo 6 caracteres)" autoComplete="new-password" className="field w-full text-foreground" required />
              <input type="password" value={firstPasswordConfirm} onChange={(e) => { setFirstPasswordConfirm(e.target.value); setFirstUserError(""); }} placeholder="Confirme a senha do usuário" autoComplete="new-password" className="field w-full text-foreground" required />
              {firstUserError && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{firstUserError}</div>}
              <button type="submit" disabled={firstUserLoading} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground disabled:opacity-50">{firstUserLoading ? "Cadastrando..." : "Cadastrar usuário e continuar"}</button>
              <p className="text-center text-xs text-muted-foreground">O primeiro usuário recebe todas as permissões. A senha da Gerência continua separada e será exigida para abrir essa área.</p>
            </form>
          </div>
        </section>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
        <AppHeader />
        <section className="min-h-[calc(100vh-7rem)] grid place-items-center">
          <div className="w-full max-w-md rounded-2xl bg-surface ring-1 ring-border p-6 sm:p-8">
            <div className="text-center">
              <img src="/mobflow-logo.svg" alt="MobFlow — PDV + Estoque" className="mx-auto block h-auto w-full max-w-[280px] object-contain" />
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">GERÊNCIA</div>
            </div>
            <div className="mt-7 space-y-4">
              <div className="rounded-xl bg-secondary/60 p-4 text-center text-sm text-muted-foreground">Sua conta está autenticada. Digite a senha da gerência para abrir esta área.</div>
              {error && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{error}</div>}
              <div className="mt-4 space-y-3">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") void confirmManagerPassword(); }}
                  placeholder="Senha da gerência"
                  autoComplete="current-password"
                  className="field w-full text-foreground"
                  autoFocus
                />
                {passwordError && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{passwordError}</div>}
                <button type="button" onClick={() => void confirmManagerPassword()} disabled={passwordLoading} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground disabled:opacity-50">
                  {passwordLoading ? "Validando..." : "Confirmar senha"}
                </button>
                <button type="button" onClick={() => { setRecoveryMessage(""); setRecoveryOpen(true); }} className="w-full py-2 text-sm font-semibold text-primary underline-offset-4 hover:underline">
                  Esqueci minha senha
                </button>
                {recoveryOpen && (
                  <div className="fixed inset-0 z-[130] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="manager-recovery-title">
                    <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl ring-1 ring-border">
                      <h2 id="manager-recovery-title" className="text-center font-display text-xl text-heading">Recuperar senha da Gerência</h2>
                      <p className="mt-2 text-center text-sm text-muted-foreground">Informe o e-mail cadastrado da empresa e o CNPJ. Enviaremos um link se os dados corresponderem à conta da Gerência.</p>
                      <form onSubmit={(e) => void requestManagerPasswordRecovery(e)} className="mt-5 space-y-3">
                        <input type="email" value={recoveryEmail} onChange={(e) => { setRecoveryEmail(e.target.value); setRecoveryMessage(""); }} placeholder="E-mail cadastrado" autoComplete="email" className="field w-full text-foreground" required />
                        <input value={recoveryCnpj} onChange={(e) => { setRecoveryCnpj(e.target.value.replace(/\D/g, "").slice(0,14)); setRecoveryMessage(""); }} inputMode="numeric" placeholder="CNPJ da empresa (somente números)" autoComplete="organization" className="field w-full text-foreground" required />
                        {recoveryMessage && <div role="status" className="rounded-lg bg-secondary/70 px-3 py-2 text-center text-sm text-muted-foreground">{recoveryMessage}</div>}
                        <button type="submit" disabled={recoveryLoading} className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-50">{recoveryLoading ? "Solicitando..." : "Enviar link de recuperação"}</button>
                        <button type="button" onClick={() => setRecoveryOpen(false)} className="w-full rounded-xl bg-secondary py-3 font-semibold text-secondary-foreground">Fechar</button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
      <AppHeader />
      <main className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-xs uppercase tracking-[.16em] text-muted-foreground">GERÊNCIA</div>
            <h1 className="mt-1 font-display text-4xl tracking-wide text-heading">Resumo rápido da operação de hoje.</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => navigate({ to: "/vendas" })} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground ring-1 ring-border hover:bg-accent">Ver mais detalhes</button>
            <button onClick={lockManagement} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-semibold text-secondary-foreground ring-1 ring-border hover:bg-accent">
              <LockKeyhole className="mr-2 inline h-4 w-4 text-green-600" />Bloquear gerência
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="financial-gradient-card">
            <div className="financial-gradient-card__content">
              <div className="text-base font-semibold text-emerald-900">Vendas de hoje</div>
              <div className="mt-2 text-3xl font-bold tracking-tight text-emerald-800 sm:text-4xl">R$ {brl(todaySales)}</div>
            </div>
          </div>
          <div className="financial-gradient-card">
            <div className="financial-gradient-card__content">
              <div className="text-base font-semibold text-emerald-900">Lucro de hoje</div>
              <div className="mt-2 text-3xl font-bold tracking-tight text-emerald-800 sm:text-4xl">R$ {brl(todayProfit)}</div>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {managementTabs.map((tab) => (
            <button key={tab.to} onClick={() => {
              if (tab.to === "/promocoes") {
                setPassword("");
                setPasswordError("");
                setPromotionPasswordOpen(true);
              } else {
                navigate({ to: tab.to });
              }
            }} className="rounded-2xl bg-white p-5 text-left ring-1 ring-border transition hover:ring-primary/50">
              <div className="text-2xl text-green-600">{tab.icon === "settings" ? <Settings className="h-6 w-6" /> : tab.icon === "stock" ? <Package className="h-6 w-6" /> : tab.icon === "sales" ? <ChartNoAxesCombined className="h-6 w-6" /> : tab.icon === "receiving" ? <Truck className="h-6 w-6" /> : tab.icon === "promotions" ? <Percent className="h-6 w-6" /> : tab.icon === "balance" ? <Scale className="h-6 w-6" /> : tab.icon === "operations" ? <Workflow className="h-6 w-6" /> : null}</div><div className="mt-3 font-bold text-heading">{tab.label}</div>
            </button>
          ))}
        </div>
        <section className="rounded-2xl bg-white p-5 ring-1 ring-border">
          <div className="font-bold text-heading">Estoque baixo</div>
          {low.length === 0 ? <div className="mt-3 text-sm text-muted-foreground">Nenhum produto com estoque baixo.</div> : (
            <div className="mt-3 divide-y divide-border">{low.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-3 text-sm"><span className="font-medium text-heading">{p.name}</span><span className="font-mono text-muted-foreground">{p.stock} / mín. {p.minStock}</span></div>
            ))}</div>
          )}
        </section>
        <section className="rounded-2xl bg-white p-5 ring-1 ring-border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-bold text-heading">Validade dos produtos</div>
            <button onClick={() => navigate({ to: "/validade" })} className="rounded-xl bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-accent">Ver todas</button>
          </div>
          {expiryItems.length === 0 ? <div className="mt-3 text-sm text-muted-foreground">Nenhuma validade cadastrada.</div> : (
            <div className="mt-3 divide-y divide-border">{expiryItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-heading">{item.name}</div>
                  <div className="text-xs text-muted-foreground">Validade: {item.expiry}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-muted-foreground">{item.quantity} {item.unit === "kg" ? "kg" : "un."}</div>
                  <div className="text-[10px] text-muted-foreground">a vencer</div>
                </div>
              </div>
            ))}</div>
          )}
        </section>
      </main>
      {promotionPasswordOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="promotion-password-title">
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl ring-1 ring-border">
            <div className="text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-green-600/10 text-green-600"><LockKeyhole className="h-5 w-5" /></div>
              <h2 id="promotion-password-title" className="mt-3 font-display text-2xl text-heading">Confirmar senha da gerência</h2>
              <p className="mt-2 text-sm text-muted-foreground">Digite novamente a senha para acessar Promoções.</p>
            </div>
            <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void confirmPromotionPassword(); }}>
              <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setPasswordError(""); }} placeholder="Senha da gerência" autoComplete="current-password" autoFocus className="field w-full text-foreground" />
              {passwordError && <div className="rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive">{passwordError}</div>}
              <button type="submit" disabled={passwordLoading} className="w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-50">{passwordLoading ? "Validando..." : "Confirmar e abrir Promoções"}</button>
              <button type="button" onClick={() => { setPromotionPasswordOpen(false); setPassword(""); setPasswordError(""); }} className="w-full rounded-xl bg-secondary py-3 font-semibold text-secondary-foreground">Cancelar</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
