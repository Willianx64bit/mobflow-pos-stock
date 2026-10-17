import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { logout } from "@/components/LoginScreen";
import { CheckCircle2, Clock3, LogOut, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

type Company = {
  account_id: string;
  company_name: string;
  cnpj: string;
  username: string;
  email: string;
  phone: string;
  plan_code: string;
  monthly_price: number;
  subscription_status: "pending_payment" | "active" | "past_due" | "suspended" | "cancelled";
  payment_method: string;
  created_at: string;
  payment_confirmed_at: string | null;
  payment_notes: string | null;
};

const statusLabels: Record<Company["subscription_status"], string> = {
  pending_payment: "Aguardando pagamento",
  active: "Ativa",
  past_due: "Pagamento atrasado",
  suspended: "Suspensa",
  cancelled: "Cancelada",
};

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
const date = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR") : "—";

export function AdminPanel() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("pending_payment");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const callAdmin = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: invokeError } = await supabase.functions.invoke("mobflow-admin-subscriptions", { body });
    if (invokeError || !data?.ok) throw new Error(data?.error || invokeError?.message || "Falha ao comunicar com o servidor.");
    return data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await callAdmin({ action: "list" });
      setCompanies(data.companies || []);
      setNotes(Object.fromEntries((data.companies || []).map((company: Company) => [company.account_id, company.payment_notes || ""])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar as empresas.");
    } finally {
      setLoading(false);
    }
  }, [callAdmin]);

  useEffect(() => { void load(); }, [load]);

  const update = async (company: Company, status: Company["subscription_status"]) => {
    setSavingId(company.account_id);
    setError("");
    setNotice("");
    try {
      await callAdmin({ action: "update", accountId: company.account_id, status, note: notes[company.account_id] || "" });
      setNotice(status === "active" ? "Pagamento confirmado e assinatura ativada." : "Status da assinatura atualizado.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível atualizar a assinatura.");
    } finally {
      setSavingId("");
    }
  };

  const visible = companies.filter((company) => filter === "all" || company.subscription_status === filter);
  const pending = companies.filter((company) => company.subscription_status === "pending_payment").length;
  const active = companies.filter((company) => company.subscription_status === "active").length;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><ShieldCheck className="h-6 w-6" /></div>
            <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-muted-foreground">MobFlow</p><h1 className="text-xl font-bold">Painel administrativo</h1></div>
          </div>
          <button onClick={async () => { await logout(); window.location.href = "/?admin=1"; }} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent"><LogOut className="h-4 w-4" /> Sair</button>
        </div>
      </header>
      <section className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <div>
          <h2 className="text-2xl font-bold">Assinaturas e pagamentos</h2>
          <p className="mt-1 text-sm text-muted-foreground">Área exclusiva para conferir cadastros, registrar observações e liberar ou suspender o acesso das empresas.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-4"><p className="text-sm text-muted-foreground">Empresas cadastradas</p><p className="mt-2 text-3xl font-bold">{companies.length}</p></div>
          <div className="rounded-xl border border-amber-500/30 bg-card p-4"><p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="h-4 w-4" /> Aguardando pagamento</p><p className="mt-2 text-3xl font-bold">{pending}</p></div>
          <div className="rounded-xl border border-emerald-500/30 bg-card p-4"><p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4" /> Assinaturas ativas</p><p className="mt-2 text-3xl font-bold">{active}</p></div>
        </div>
        {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        {notice && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{notice}</div>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {[["pending_payment","Pendentes"],["active","Ativas"],["suspended","Suspensas"],["all","Todas"]].map(([value,label]) => <button key={value} onClick={() => setFilter(value)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${filter === value ? "bg-primary text-primary-foreground" : "border border-border hover:bg-accent"}`}>{label}</button>)}
          </div>
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar</button>
        </div>
        {loading ? <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">Carregando assinaturas…</div> : visible.length === 0 ? <div className="rounded-xl border border-border p-8 text-center"><p className="font-semibold">Nenhuma empresa nesta categoria</p><p className="mt-1 text-sm text-muted-foreground">Os novos cadastros aparecerão aqui.</p></div> : (
          <div className="space-y-4">
            {visible.map((company) => (
              <article key={company.account_id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h3 className="text-lg font-bold">{company.company_name}</h3><p className="text-sm text-muted-foreground">Usuário: {company.username} · CNPJ: {company.cnpj}</p><p className="mt-1 text-sm text-muted-foreground">{company.email} · {company.phone}</p></div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${company.subscription_status === "active" ? "bg-emerald-500/10 text-emerald-700" : company.subscription_status === "pending_payment" ? "bg-amber-500/10 text-amber-700" : "bg-secondary text-secondary-foreground"}`}>{statusLabels[company.subscription_status]}</span>
                </div>
                <div className="mt-4 grid gap-2 rounded-lg bg-secondary/40 p-3 text-sm sm:grid-cols-3">
                  <p><span className="text-muted-foreground">Plano:</span> MobFlow Completo</p><p><span className="text-muted-foreground">Valor:</span> {money(company.monthly_price)}/mês</p><p><span className="text-muted-foreground">Cadastro:</span> {date(company.created_at)}</p>
                  <p className="sm:col-span-3"><span className="text-muted-foreground">Pagamento confirmado:</span> {date(company.payment_confirmed_at)}</p>
                </div>
                <label className="mt-4 block text-sm font-semibold">Observações da conferência</label>
                <textarea value={notes[company.account_id] || ""} onChange={(e) => setNotes((prev) => ({ ...prev, [company.account_id]: e.target.value }))} maxLength={1000} placeholder="Ex.: comprovante conferido, data e referência do pagamento…" className="mt-1 min-h-20 w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary" />
                <div className="mt-3 flex flex-wrap gap-2">
                  {company.subscription_status !== "active" && <button disabled={savingId === company.account_id} onClick={() => void update(company, "active")} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> {savingId === company.account_id ? "Salvando…" : "Confirmar pagamento e ativar"}</button>}
                  {company.subscription_status !== "pending_payment" && <button disabled={savingId === company.account_id} onClick={() => void update(company, "pending_payment")} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-semibold hover:bg-accent disabled:opacity-50"><Clock3 className="h-4 w-4" /> Voltar para pendente</button>}
                  {company.subscription_status !== "suspended" && <button disabled={savingId === company.account_id} onClick={() => void update(company, "suspended")} className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2.5 text-sm font-semibold text-destructive hover:bg-destructive/5 disabled:opacity-50"><XCircle className="h-4 w-4" /> Suspender</button>}
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">A ativação libera o login da empresa. Confira o comprovante fora do sistema antes de confirmar; esta tela não recebe pagamentos automaticamente.</p>
      </section>
    </main>
  );
}
