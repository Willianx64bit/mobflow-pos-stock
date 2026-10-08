import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const { username, password, cnpj } = await req.json();
    const cleanUsername = String(username ?? "").trim().toUpperCase();
    const cleanPassword = String(password ?? "");
    const cleanCnpj = String(cnpj ?? "").replace(/\D/g, "");
    if (!cleanUsername || cleanPassword.length < 6 || cleanCnpj.length !== 14) return json({ error: "Usuário, senha ou CNPJ inválido." }, 400);
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const email = cleanUsername.toLowerCase().replace(/[^a-z0-9._-]/g, "-") + "@accounts.mobflow.local";
    const { data: profile, error: profileError } = await admin.from("profiles").select("id,username,cnpj,account_id,role,active,display_name").eq("username", cleanUsername).maybeSingle();
    if (profileError) return json({ error: "Não foi possível validar a conta." }, 500);
    if (profile) {
      if (profile.cnpj !== cleanCnpj || !profile.active) return json({ error: "Usuário, CNPJ ou acesso inválido." }, 401);
    } else {
      const { data: allowed } = await admin.from("account_allowlist").select("username,cnpj,active").eq("username", cleanUsername).eq("cnpj", cleanCnpj).eq("active", true).maybeSingle();
      if (!allowed) return json({ error: "Usuário não autorizado." }, 401);
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: cleanPassword, email_confirm: true });
      if (createError || !created.user) return json({ error: createError?.message ?? "Não foi possível criar a conta." }, 400);
      const { error: insertError } = await admin.from("profiles").insert({ id: created.user.id, username: cleanUsername, cnpj: cleanCnpj, account_id: created.user.id, role: "manager", active: true, display_name: cleanUsername });
      if (insertError) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: "Não foi possível preparar a conta." }, 500); }
    }
    const { data, error } = await client.auth.signInWithPassword({ email, password: cleanPassword });
    if (error || !data.session) return json({ error: "Usuário ou senha inválido." }, 401);
    return json({ session: data.session, profile: { username: profile?.username ?? cleanUsername, role: profile?.role ?? "manager", account_id: profile?.account_id ?? data.user?.id ?? null, display_name: profile?.display_name ?? cleanUsername } });
  } catch { return json({ error: "Não foi possível entrar agora." }, 500); }
});