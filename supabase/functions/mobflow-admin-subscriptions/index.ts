import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sessão necessária." }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceKey || !anonKey) return json({ error: "Serviço indisponível." }, 503);

    const authClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Sessão inválida." }, 401);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,role,active").eq("id", userData.user.id).maybeSingle();
    if (profileError || !profile || profile.role !== "admin" || !profile.active) {
      return json({ error: "Acesso administrativo não autorizado." }, 403);
    }

    const body = await req.json();
    if (body.action === "list") {
      const { data, error } = await admin.from("companies")
        .select("account_id,company_name,cnpj,username,email,phone,plan_code,monthly_price,subscription_status,payment_method,created_at,payment_confirmed_at,payment_notes")
        .order("created_at", { ascending: false });
      if (error) return json({ error: "Não foi possível carregar as assinaturas." }, 500);
      return json({ ok: true, companies: data ?? [] });
    }

    if (body.action === "update") {
      const accountId = String(body.accountId ?? "");
      const status = String(body.status ?? "");
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
      const allowedStatuses = ["pending_payment", "active", "past_due", "suspended", "cancelled"];
      if (!accountId || !allowedStatuses.includes(status)) return json({ error: "Dados de atualização inválidos." }, 400);

      const updates: Record<string, unknown> = {
        subscription_status: status,
        updated_at: new Date().toISOString(),
        payment_notes: note || null,
      };
      if (status === "active") {
        updates.payment_confirmed_at = new Date().toISOString();
        updates.payment_confirmed_by = userData.user.id;
      } else if (status === "pending_payment") {
        updates.payment_confirmed_at = null;
        updates.payment_confirmed_by = null;
      }
      const { data, error } = await admin.from("companies").update(updates)
        .eq("account_id", accountId)
        .select("account_id,company_name,subscription_status,payment_confirmed_at,payment_notes")
        .maybeSingle();
      if (error) return json({ error: "Não foi possível atualizar a assinatura." }, 500);
      if (!data) return json({ error: "Empresa não encontrada." }, 404);
      return json({ ok: true, company: data });
    }

    return json({ error: "Ação inválida." }, 400);
  } catch (error) {
    console.error("mobflow-admin-subscriptions error", error);
    return json({ error: "Não foi possível concluir a operação." }, 500);
  }
});