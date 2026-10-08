import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Sessão não encontrada." }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Sessão inválida." }, 401);
    const { data: manager, error: managerError } = await admin.from("profiles").select("id,username,cnpj,account_id,role,active").eq("id", authData.user.id).maybeSingle();
    if (managerError || !manager || manager.role !== "manager" || !manager.active) return json({ error: "Acesso de gerência necessário." }, 403);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "list");
    if (action === "list") {
      const { data, error } = await admin.from("profiles").select("id,username,display_name,role,active,created_at").eq("account_id", manager.account_id).eq("role", "pdv").order("created_at", { ascending: false });
      if (error) return json({ error: "Não foi possível carregar os usuários." }, 500);
      return json({ users: data ?? [] });
    }
    if (action === "create") {
      const username = String(body.username ?? "").trim().toUpperCase();
      const displayName = String(body.displayName ?? "").trim() || username;
      const password = String(body.password ?? "");
      if (!/^[A-Z0-9._-]{3,40}$/.test(username)) return json({ error: "Usuário inválido. Use letras, números, ponto, hífen ou underline." }, 400);
      if (password.length < 6) return json({ error: "A senha precisa ter pelo menos 6 caracteres." }, 400);
      const { data: existing } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
      if (existing) return json({ error: "Esse usuário já existe." }, 409);
      const email = username.toLowerCase().replace(/[^a-z0-9._-]/g, "-") + "@accounts.mobflow.local";
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName, role: "pdv" } });
      if (createError || !created.user) return json({ error: createError?.message ?? "Não foi possível criar o usuário." }, 400);
      const { error: insertError } = await admin.from("profiles").insert({ id: created.user.id, username, cnpj: manager.cnpj, account_id: manager.account_id, role: "pdv", active: true, display_name: displayName });
      if (insertError) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: "Não foi possível salvar o usuário." }, 500); }
      return json({ ok: true });
    }
    const userId = String(body.userId ?? "");
    if (!userId) return json({ error: "Usuário não informado." }, 400);
    const { data: target } = await admin.from("profiles").select("id,account_id,role").eq("id", userId).maybeSingle();
    if (!target || target.account_id !== manager.account_id || target.role !== "pdv") return json({ error: "Usuário não encontrado." }, 404);
    if (action === "toggle") {
      const active = Boolean(body.active);
      const { error } = await admin.from("profiles").update({ active }).eq("id", userId);
      if (error) return json({ error: "Não foi possível alterar o acesso." }, 500);
      return json({ ok: true });
    }
    if (action === "reset_password") {
      const password = String(body.password ?? "");
      if (password.length < 6) return json({ error: "A senha precisa ter pelo menos 6 caracteres." }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: "Não foi possível trocar a senha." }, 500);
      return json({ ok: true });
    }
    return json({ error: "Ação inválida." }, 400);
  } catch { return json({ error: "Não foi possível concluir a operação." }, 500); }
});