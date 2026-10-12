import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabase";

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

export function LoginScreen({ onLogin, mode = "empresa" }: { onLogin: () => void; mode?: "empresa" | "pdv" }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(() => localStorage.getItem(REMEMBER_KEY) === "1");

  const formatCnpj = (value: string) => value.replace(/\D/g, "").slice(0, 14).replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    localStorage.setItem(REMEMBER_KEY, rememberLogin ? "1" : "0");
    if (!rememberLogin) localStorage.removeItem(AUTH_KEY);

    try {
      // Troca de conta: evita manter uma sessão antiga de PDV ao entrar na gerência
      // (ou vice-versa), que poderia fazer a API de usuários responder "Acesso de gerência necessário".
      await supabase.auth.signOut();
      sessionStorage.removeItem("mobflow-management");
      sessionStorage.removeItem("mobflow-pdv-authorized");
      sessionStorage.removeItem("mobflow-role");
      sessionStorage.removeItem("mobflow-username");

      const loginCnpj = mode === "pdv" ? "" : cnpj;
      const { data, error } = await supabase.functions.invoke("mobflow-login", {
        body: { username: username.trim(), password, cnpj: loginCnpj },
      });

      if (error || !data?.session) {
        let msg = data?.error as string | undefined;
        try { msg = msg || (await (error as { context?: Response })?.context?.json())?.error; } catch {}
        setError(msg || "Não foi possível entrar. Verifique o usuário e a senha.");
        return;
      }

      if (mode === "pdv" && data.profile?.role !== "pdv") {
        setError("Esse usuário não é um usuário do PDV.");
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
      if (mode === "pdv") sessionStorage.setItem("mobflow-pdv-authorized", "1");
      sessionStorage.setItem("mobflow-role", data.profile?.role === "manager" ? "manager" : "pdv");
      sessionStorage.setItem("mobflow-username", data.profile?.username || username.trim().toUpperCase());
      onLogin();
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background px-4 py-6">
      <div className="mfb-in w-full max-w-md rounded-2xl bg-surface ring-1 ring-border p-6 sm:p-8">
        <div className="mx-auto w-full max-w-[340px] text-center">
          <svg viewBox="0 0 520 300" role="img" aria-label="MobFlow — PDV e estoque" className="mx-auto h-auto w-full max-w-[320px]">
            <defs>
              <linearGradient id="mobflow-mark" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#22b76b" />
                <stop offset="100%" stopColor="#005744" />
              </linearGradient>
              <linearGradient id="mobflow-word" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#172630" />
                <stop offset="48%" stopColor="#172630" />
                <stop offset="49%" stopColor="#078653" />
                <stop offset="100%" stopColor="#078653" />
              </linearGradient>
            </defs>
            <g transform="translate(98 12) scale(1.05)" fill="none" stroke="url(#mobflow-mark)" strokeWidth="17" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 22h40q15 0 19 15l28 104q4 14 19 14h105q14 0 18-14l19-73" />
              <path d="M85 70h43M67 99h66M99 128h42" strokeWidth="13" />
              <path d="M110 55l17 59 28-38 29 28 64-47" strokeWidth="16" />
              <path d="M233 57l30-8-5 30" strokeWidth="15" />
              <circle cx="130" cy="178" r="12" fill="#005744" stroke="none" />
              <circle cx="211" cy="178" r="12" fill="#005744" stroke="none" />
            </g>
            <text x="260" y="267" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontSize="66" fontWeight="800" letterSpacing="-3" fill="url(#mobflow-word)">MobFlow</text>
          </svg>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[.24em] text-muted-foreground">PDV + ESTOQUE</div>
        </div>

        <div className="mt-8 text-center">
          <h1 className="font-display text-xl tracking-[.1em] text-heading">{mode === "pdv" ? "USUÁRIO DO PDV" : "LOGIN DA EMPRESA"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{mode === "pdv" ? "Informe o usuário e a senha liberados pela gerência." : "Informe os dados da empresa para entrar."}</p>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label className="label-mono block mb-1.5">Usuário</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="Nome de usuário" className="field w-full text-foreground" autoFocus />
          </div>

          <div>
            <label className="label-mono block mb-1.5">Senha</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder="Senha" className="field w-full text-foreground" />
          </div>

          {error && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{error}</div>}

          {mode !== "pdv" && (
            <div>
              <label className="label-mono block mb-1.5">CNPJ</label>
              <input value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} inputMode="numeric" autoComplete="organization" placeholder="00.000.000/0000-00" className="field w-full text-foreground" />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={rememberLogin} onChange={(e) => setRememberLogin(e.target.checked)} className="h-4 w-4 accent-primary" />
            <span>Salvar login</span>
          </label>

          <button type="submit" disabled={loading} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground hover:bg-primary/85 transition-colors disabled:opacity-50">
            {loading ? "Validando..." : "Entrar"}
          </button>
        </form>

        <p className="mt-5 text-center font-mono text-[10px] text-muted-foreground">Acesso restrito · informe as credenciais cadastradas</p>
      </div>
    </div>
  );
}
