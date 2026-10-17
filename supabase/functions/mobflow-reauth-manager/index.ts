import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS"};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type":"application/json" } });

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Sessão não encontrada." }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "verify");
    const password = String(body.password ?? "");
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Sessão inválida." }, 401);
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,username,role,active,account_id,permissions").eq("id", authData.user.id).maybeSingle();
    if (profileError || !profile || !profile.active || (profile.role !== "manager" && !(profile.role === "pdv" && Array.isArray(profile.permissions) && profile.permissions.includes("Gerência"))) || !profile.account_id) {
      return json({ error: "Acesso de gerência necessário." }, 403);
    }
    const { data: security, error: securityError } = await admin.from("manager_security_by_account")
      .select("password_hash").eq("account_id", profile.account_id).maybeSingle();
    if (securityError) return json({ error: "Não foi possível consultar a configuração da gerência." }, 500);

    if (action === "status") return json({ configured: Boolean(security?.password_hash), role: profile.role });

    if (action === "set_password") {
      if (password.length < 8) return json({ error: "A senha da gerência precisa ter pelo menos 8 caracteres." }, 400);
      if (security?.password_hash) return json({ error: "A senha da gerência já foi configurada. Use a senha atual para entrar." }, 409);
      const { error } = await admin.from("manager_security_by_account").insert({
        account_id: profile.account_id, password_hash: await sha256(password), updated_at: new Date().toISOString()
      });
      if (error) {
        if (error.code === "23505") return json({ error: "A senha da gerência já foi configurada. Atualize a tela e tente entrar." }, 409);
        return json({ error: "Não foi possível salvar a senha da gerência." }, 500);
      }
      return json({ ok: true });
    }

    if (action !== "verify") return json({ error: "Ação inválida." }, 400);
    if (!password) return json({ error: "Senha inválida." }, 401);
    if (!security?.password_hash) return json({ error: "Senha da gerência não configurada para esta empresa." }, 403);
    if (await sha256(password) !== security.password_hash) return json({ error: "Senha da gerência incorreta." }, 401);
    return json({ ok: true });
  } catch {
    return json({ error: "Não foi possível concluir a operação agora." }, 500);
  }
});