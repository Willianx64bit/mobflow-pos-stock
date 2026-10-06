import { FormEvent, useState } from "react";

const VALID_USERNAME_HASH = "0a41dbd0bbe8517ad8eb785900b11b23b23d9a61e62bc68362d2f0c9182c2de9";
const VALID_PASSWORD_HASH = "ffdb88d3c5bb1a79855f2a675ed200e39ae49a19319c8c3410bbc74bc10a49f9";
const VALID_CNPJ_HASH = "d6bed3e585a9ae4dcc72fcb07b67fbd79902ed8e4f322d2f4c67d0f5b6f926f8";
const AUTH_KEY = "mobflow-authenticated";

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isAuthenticated() {
  return localStorage.getItem(AUTH_KEY) === "1";
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
}

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const formatCnpj = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 14);
    return digits
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
      .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const [u, p, c] = await Promise.all([
      sha256(username.trim()),
      sha256(password),
      sha256(cnpj.replace(/\D/g, "")),
    ]);
    if (u === VALID_USERNAME_HASH && p === VALID_PASSWORD_HASH && c === VALID_CNPJ_HASH) {
      localStorage.setItem(AUTH_KEY, "1");
      onLogin();
    } else {
      setError("Usuário, senha ou CNPJ inválido.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="mfb-in w-full max-w-md rounded-2xl bg-surface ring-1 ring-border p-6 sm:p-8">
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/15 ring-1 ring-primary/40 grid place-items-center font-display text-3xl text-primary">M</div>
          <div className="mt-4 font-display tracking-[.18em] text-3xl text-heading">MOBFLOW</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[.2em] text-muted-foreground">PDV + ESTOQUE</div>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <label className="label-mono block mb-1.5">Nome de usuário</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="Nome de usuário" className="field w-full text-foreground" autoFocus />
          </div>
          <div>
            <label className="label-mono block mb-1.5">Senha</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder="Senha" className="field w-full text-foreground" />
          </div>
          <div>
            <label className="label-mono block mb-1.5">CNPJ</label>
            <input value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} inputMode="numeric" autoComplete="organization" placeholder="00.000.000/0000-00" className="field w-full font-mono text-foreground" />
          </div>
          {error && <div className="rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-center text-sm text-destructive">{error}</div>}
          <button type="submit" disabled={loading} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground hover:bg-primary/85 transition-colors disabled:opacity-50">
            {loading ? "Validando..." : "Entrar no MobFlow"}
          </button>
        </form>
        <p className="mt-5 text-center font-mono text-[10px] text-muted-foreground">Acesso restrito · informe as credenciais cadastradas</p>
      </div>
    </div>
  );
}
