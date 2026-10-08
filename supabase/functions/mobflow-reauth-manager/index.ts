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

    const { password } = await req.json().catch(() => ({}));
    const cleanPassword = String(password ?? "");
    if (cleanPassword.length < 6) return json({ error: "Senha inválida." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Sessão inválida." }, 401);

    const { data: manager, error: managerError } = await admin
      .from("profiles")
      .select("id,username,role,active")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (managerError || !manager || !manager.active || manager.role !== "manager") {
      return json({ error: "Acesso de gerência necessário." }, 403);
    }

    const email = String(manager.username ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-") + "@accounts.mobflow.local";
    const { data, error } = await client.auth.signInWithPassword({ email, password: cleanPassword });
    if (error || !data.user) return json({ error: "Senha da gerência incorreta." }, 401);

    return json({ ok: true });
  } catch {
    return json({ error: "Não foi possível validar a senha agora." }, 500);
  }
});