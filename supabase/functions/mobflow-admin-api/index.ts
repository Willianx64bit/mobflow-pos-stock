import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ADMIN_ALLOWED_ORIGIN") ?? "http://localhost:5173",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const adminEmail = Deno.env.get("MOBFLOW_ADMIN_EMAIL")?.trim().toLowerCase();

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !adminEmail) {
    return json({ ok: false, error: "A configuração segura do painel administrativo está incompleta." }, 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Autenticação obrigatória." }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const accessToken = authHeader.slice("Bearer ".length).trim();
  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user?.email) return json({ ok: false, error: "Sessão inválida. Entre novamente." }, 401);
  if (userData.user.email.trim().toLowerCase() !== adminEmail) {
    return json({ ok: false, error: "Esta conta não tem permissão para administrar o MobFlow." }, 403);
  }

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Solicitação inválida." }, 400);
  }

  if (body.action !== "list_companies") {
    return json({ ok: false, error: "Ação ainda não habilitada." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: companies, error } = await adminClient
    .from("companies")
    .select("account_id,company_name,cnpj,username,email,phone,monthly_price,subscription_status,created_at,payment_confirmed_at,payment_submitted_at,manager_setup_completed_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("admin list_companies failed", error.message);
    return json({ ok: false, error: "Não foi possível consultar as empresas agora." }, 500);
  }

  return json({ ok: true, companies: companies ?? [] });
});