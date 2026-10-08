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
  await supabase.auth.signOut();
}

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
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
      const { data, error } = await supabase.functions.invoke("mobflow-login", {
        body: { username: username.trim(), password, cnpj },
      });

      if (error || !data?.session) {
        setError(data?.error || "Não foi possível entrar. Verifique o usuário e a senha.");
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
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/15 ring-1 ring-primary/40 grid place-items-center font-display text-3xl text-primary">M</div>
          <div className="mt-4 font-display tracking-[.18em] text-3xl text-heading">MOBFLOW</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">PDV + ESTOQUE</div>
        </div>

        <div className="mt-8 text-center">
          <h1 className="font-display text-xl tracking-[.1em] text-heading">LOGIN DA EMPRESA</h1>
          <p className="mt-1 text-sm text-muted-foreground">Informe os dados da empresa para entrar.</p>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label className="label-mono block mb-1.5">Usuário</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="Nome de usuário"
              className="field w-full text-foreground"
              autoFocus
            />
          </div>

          
          <div>
            <label className="label-mono block mb-1.5">Senha</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="Senha"
              className="field w-full text-foreground"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">
              {error}
            </div>
          )}

          <div>
            <label className="label-mono block mb-1.5">CNPJ</label>
            <input value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} inputMode="numeric" autoComplete="organization" placeholder="00.000.000/0000-00" className="field w-full text-foreground" />
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberLogin}
              onChange={(e) => setRememberLogin(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span>Salvar login</span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground hover:bg-primary/85 transition-colors disabled:opacity-50"
          >
            {loading ? "Validando..." : "Entrar"}
          </button>
        </form>

        <p className="mt-5 text-center font-mono text-[10px] text-muted-foreground">
          Acesso restrito · informe as credenciais cadastradas
        </p>
      </div>
    </div>
  );
}
