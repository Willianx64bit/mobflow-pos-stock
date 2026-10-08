import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { supabase } from "@/lib/supabase";

type PdvUser = { id: string; username: string; display_name?: string | null; role: "pdv"; active: boolean; created_at: string };

export const Route = createFileRoute("/usuarios")({
  head: () => ({ meta: [{ title: "MobFlow — Usuários do PDV" }] }),
  component: Usuarios,
});

function Usuarios() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<PdvUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    const { data, error } = await supabase.functions.invoke("mobflow-users", { body: { action: "list" } });
    if (error || !data?.users) setError(data?.error || "Não foi possível carregar os usuários.");
    else setUsers(data.users);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const create = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    const { data, error } = await supabase.functions.invoke("mobflow-users", {
      body: { action: "create", displayName: name, username, password },
    });
    if (error || !data?.ok) {
      setError(data?.error || "Não foi possível criar o usuário.");
    } else {
      setName(""); setUsername(""); setPassword("");
      setMessage("Usuário do PDV criado com sucesso.");
      await load();
    }
    setSaving(false);
  };

  const toggle = async (user: PdvUser) => {
    setError("");
    const { data, error } = await supabase.functions.invoke("mobflow-users", {
      body: { action: "toggle", userId: user.id, active: !user.active },
    });
    if (error || !data?.ok) setError(data?.error || "Não foi possível alterar o acesso.");
    else await load();
  };

  const resetPassword = async (user: PdvUser) => {
    const next = window.prompt(`Nova senha para ${user.username} (mínimo 6 caracteres):`);
    if (!next) return;
    setError("");
    const { data, error } = await supabase.functions.invoke("mobflow-users", {
      body: { action: "reset_password", userId: user.id, password: next },
    });
    if (error || !data?.ok) setError(data?.error || "Não foi possível trocar a senha.");
    else setMessage("Senha alterada.");
  };

  return (
    <div className="mfb-in min-h-screen bg-sky-50/35 p-4 md:p-6">
      <AppHeader />
      <main className="space-y-4">
        <section className="glass p-5">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => navigate({ to: "/gerencia" })} className="rounded-xl bg-secondary px-4 py-2 text-sm text-secondary-foreground">← Gerência</button>
            <div>
              <div className="font-display text-2xl tracking-[.1em] text-heading">USUÁRIOS DO PDV</div>
              <div className="text-sm text-muted-foreground">Crie acessos individuais para os operadores do caixa.</div>
            </div>
          </div>
        </section>

        <section className="glass p-5">
          <div className="mb-4">
            <h2 className="font-semibold text-heading">+ Novo usuário</h2>
            <p className="text-xs text-muted-foreground mt-1">Esse acesso compartilha os mesmos produtos, vendas e estoque da empresa.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Nome do operador" className="field text-sm text-foreground" />
            <input value={username} onChange={e => setUsername(e.target.value.toUpperCase())} placeholder="Usuário (ex.: JOAO)" className="field text-sm text-foreground" />
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Senha (mín. 6)" className="field text-sm text-foreground" />
          </div>
          {error && <div className="mt-3 rounded-lg bg-destructive/10 ring-1 ring-destructive/30 px-3 py-2 text-sm text-destructive">{error}</div>}
          {message && <div className="mt-3 rounded-lg bg-primary/10 ring-1 ring-primary/30 px-3 py-2 text-sm text-primary">{message}</div>}
          <button onClick={() => void create()} disabled={saving || username.trim().length < 3 || password.length < 6} className="mt-3 w-full rounded-xl bg-primary py-3 font-bold text-primary-foreground disabled:opacity-40">
            {saving ? "Criando..." : "Criar usuário do PDV"}
          </button>
        </section>

        <section className="glass p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div><h2 className="font-semibold text-heading">Operadores cadastrados</h2><p className="text-xs text-muted-foreground">Desative um acesso sem apagar o histórico das vendas.</p></div>
            <button onClick={() => void load()} className="rounded-lg bg-secondary px-3 py-2 text-xs text-secondary-foreground">Atualizar</button>
          </div>
          {loading ? <div className="py-8 text-center text-sm text-muted-foreground">Carregando...</div> : !users.length ? <div className="py-8 text-center text-sm text-muted-foreground">Nenhum usuário de PDV cadastrado.</div> : (
            <div className="divide-y divide-border/50">
              {users.map(user => (
                <div key={user.id} className="py-3 flex flex-wrap items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center text-primary font-bold">PDV</div>
                  <div className="flex-1 min-w-40">
                    <div className="font-semibold text-foreground">{user.display_name || user.username}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">@{user.username}</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${user.active ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>{user.active ? "Ativo" : "Desativado"}</span>
                  <div className="flex gap-2">
                    <button onClick={() => void resetPassword(user)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground">Trocar senha</button>
                    <button onClick={() => void toggle(user)} className="rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground">{user.active ? "Desativar" : "Ativar"}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
