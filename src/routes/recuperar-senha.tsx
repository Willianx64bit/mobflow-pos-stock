import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/recuperar-senha")({
  head: () => ({ meta: [{ title: "MobFlow — Recuperar senha da Gerência" }] }),
  component: RecuperarSenha,
});

function RecuperarSenha() {
  const navigate = useNavigate();
  const [token] = useState(() => typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") ?? "" : "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!token) {
      setError("Este link não contém um código de recuperação. Solicite um novo link pela tela da Gerência.");
      return;
    }
    if (password.length < 8) {
      setError("A nova senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas não são iguais.");
      return;
    }
    setBusy(true);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("mobflow-manager-password-recovery", {
        body: { action: "reset", token, password },
      });
      if (invokeError || !data?.ok) {
        let detail = String(data?.error ?? "");
        try {
          if (!detail) detail = String((await (invokeError as { context?: Response })?.context?.json())?.error ?? "");
        } catch {}
        setError(detail || "Não foi possível alterar a senha. Solicite um novo link e tente novamente.");
        return;
      }
      setSuccess(data.message || "Senha da Gerência alterada com sucesso.");
      setPassword("");
      setConfirmPassword("");
    } catch {
      setError("Não foi possível conectar ao serviço de recuperação.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background px-4 py-6">
      <section className="mfb-in w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl ring-1 ring-border sm:p-8">
        <div className="mx-auto w-full max-w-[280px] text-center">
          <img src="/mobflow-logo.svg" alt="MobFlow — PDV e estoque" className="mx-auto block h-auto w-full object-contain" />
        </div>
        <div className="mt-7 text-center">
          <h1 className="font-display text-xl tracking-[.08em] text-heading">RECUPERAR SENHA DA GERÊNCIA</h1>
          <p className="mt-2 text-sm text-muted-foreground">Crie uma nova senha exclusiva para acessar a Gerência. Use pelo menos 8 caracteres.</p>
        </div>

        {success ? (
          <div className="mt-6 space-y-4">
            <div role="status" className="rounded-lg bg-emerald-500/10 px-3 py-3 text-center text-sm text-emerald-700">{success}</div>
            <button type="button" onClick={() => void navigate({ to: "/" })} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground">Voltar ao MobFlow</button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nova senha (mínimo 8 caracteres)" autoComplete="new-password" className="field w-full text-foreground" required minLength={8} />
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirme a nova senha" autoComplete="new-password" className="field w-full text-foreground" required minLength={8} />
            {error && <div role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</div>}
            <button type="submit" disabled={busy || !token} className="w-full rounded-xl bg-primary py-3.5 font-bold text-primary-foreground disabled:opacity-50">
              {busy ? "Salvando nova senha..." : "Salvar nova senha"}
            </button>
            {!token && <p className="text-center text-sm text-muted-foreground">O link está incompleto. Volte à tela da Gerência e solicite outro.</p>}
          </form>
        )}
      </section>
    </div>
  );
}
