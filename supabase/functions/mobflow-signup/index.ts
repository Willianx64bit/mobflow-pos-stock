import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const cleanDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const normalizeUsername = (value: unknown) => String(value ?? "").trim().toUpperCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  let createdUserId: string | null = null;
  try {
    const body = await req.json();
    const companyName = String(body.companyName ?? "").trim();
    const username = normalizeUsername(body.username);
    const password = String(body.password ?? "");
    const cnpj = cleanDigits(body.cnpj);
    const phone = cleanDigits(body.phone);
    const email = String(body.email ?? "").trim().toLowerCase();

    if (companyName.length < 2 || companyName.length > 120) {
      return json({ error: "Informe o nome da empresa (2 a 120 caracteres)." }, 400);
    }
    if (!/^[A-Z0-9._-]{3,40}$/.test(username)) {
      return json({ error: "O usuário deve ter de 3 a 40 caracteres: letras, números, ponto, hífen ou underline." }, 400);
    }
    if (password.length < 8 || password.length > 128) {
      return json({ error: "A senha precisa ter pelo menos 8 caracteres." }, 400);
    }
    if (cnpj.length !== 14) return json({ error: "Informe um CNPJ com 14 números." }, 400);
    if (phone.length < 10 || phone.length > 13) return json({ error: "Informe um telefone válido com DDD." }, 400);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Informe um e-mail válido." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "Cadastro temporariamente indisponível." }, 503);
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: existingProfile } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
    if (existingProfile) return json({ error: "Esse nome de usuário já está em uso." }, 409);

    const { data: existingCnpj } = await admin.from("companies").select("account_id").eq("cnpj", cnpj).maybeSingle();
    if (existingCnpj) return json({ error: "Já existe um cadastro com esse CNPJ." }, 409);
    const { data: existingEmail } = await admin.from("companies").select("account_id").ilike("email", email).maybeSingle();
    if (existingEmail) return json({ error: "Já existe um cadastro com esse e-mail." }, 409);

    const authEmail = username.toLowerCase().replace(/[^a-z0-9._-]/g, "-") + "@accounts.mobflow.local";
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { username, role: "manager" },
    });
    if (createError || !created.user) {
      const message = createError?.message ?? "";
      if (message.toLowerCase().includes("already")) return json({ error: "Esse nome de usuário já está em uso." }, 409);
      console.error("mobflow-signup auth create failed", message);
      return json({ error: "Não foi possível criar a conta agora." }, 500);
    }
    createdUserId = created.user.id;

    const { error: companyError } = await admin.from("companies").insert({
      account_id: created.user.id,
      company_name: companyName,
      cnpj,
      username,
      email,
      phone,
      plan_code: "complete",
      monthly_price: 79.90,
      subscription_status: "pending_payment",
    });
    if (companyError) {
      await admin.auth.admin.deleteUser(created.user.id);
      createdUserId = null;
      if (companyError.code === "23505") return json({ error: "Já existe um cadastro com esse CNPJ, usuário ou e-mail." }, 409);
      console.error("mobflow-signup company insert failed", companyError.message);
      return json({ error: "Não foi possível salvar os dados da empresa." }, 500);
    }

    const { error: profileError } = await admin.from("profiles").insert({
      id: created.user.id,
      username,
      cnpj,
      account_id: created.user.id,
      role: "manager",
      active: true,
      display_name: companyName,
      permissions: ["PDV", "Conferência", "Validade", "Fiado", "Gerência"],
    });
    if (profileError) {
      await admin.from("companies").delete().eq("account_id", created.user.id);
      await admin.auth.admin.deleteUser(created.user.id);
      createdUserId = null;
      console.error("mobflow-signup profile insert failed", profileError.message);
      return json({ error: "Não foi possível preparar o acesso da empresa." }, 500);
    }

    const initialState = {
      products: [], cart: [], sales: [], conferences: [], receiving: [],
      manualExpiries: [], promotions: [], suppliers: [],
      settings: { companyName },
    };
    const { error: stateError } = await admin.from("app_state").insert({
      owner_id: created.user.id,
      state: initialState,
      updated_at: new Date().toISOString(),
    });
    if (stateError) {
      await admin.from("profiles").delete().eq("id", created.user.id);
      await admin.from("companies").delete().eq("account_id", created.user.id);
      await admin.auth.admin.deleteUser(created.user.id);
      createdUserId = null;
      console.error("mobflow-signup app_state insert failed", stateError.message);
      return json({ error: "Não foi possível inicializar os dados da empresa." }, 500);
    }

    return json({
      ok: true,
      subscriptionStatus: "pending_payment",
      message: "Cadastro recebido. A assinatura de R$ 79,90/mês ficará pendente até a confirmação do pagamento e ativação do acesso.",
    }, 201);
  } catch (error) {
    console.error("mobflow-signup unexpected error", error);
    if (createdUserId) {
      const url = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (url && serviceKey) {
        const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
        await admin.from("profiles").delete().eq("id", createdUserId);
        await admin.from("companies").delete().eq("account_id", createdUserId);
        await admin.from("app_state").delete().eq("owner_id", createdUserId);
        await admin.auth.admin.deleteUser(createdUserId);
      }
    }
    return json({ error: "Não foi possível concluir o cadastro agora." }, 500);
  }
});