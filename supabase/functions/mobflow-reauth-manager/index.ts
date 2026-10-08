import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Sessão não encontrada." }, 401);

    const { password } = await req.json().catch(() => ({}));
    const cleanPassword = String(password ?? "");
    if (cleanPassword.length < 1) return json({ error: "Senha inválida." }, 401);

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

    const { data: security, error: securityError } = await admin
      .from("manager_security")
      .select("password_hash")
      .eq("id", true)
      .maybeSingle();

    if (securityError || !security?.password_hash) {
      return json({ error: "Configuração de segurança da gerência indisponível." }, 500);
    }

    const suppliedHash = await sha256(cleanPassword);
    if (suppliedHash !== security.password_hash) {
      return json({ error: "Senha da gerência incorreta." }, 401);
    }

    return json({ ok: true });
  } catch {
    return json({ error: "Não foi possível validar a senha agora." }, 500);
  }
});