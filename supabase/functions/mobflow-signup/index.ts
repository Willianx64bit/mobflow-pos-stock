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
const tlv = (id: string, value: string) => id + String(value.length).padStart(2, "0") + value;
const crc16 = (input: string) => {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
};
const buildPixPayload = (key: string, name: string, city: string, amount: number) => {
  const cleanName = name.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^A-Z0-9 .&-]/gi, "").toUpperCase().slice(0, 25) || "MOBFLOW";
  const cleanCity = city.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^A-Z0-9 .-]/gi, "").toUpperCase().slice(0, 15) || "SAO PAULO";
  const merchant = tlv("00", "BR.GOV.BCB.PIX") + tlv("01", key);
  const additional = tlv("05", "***");
  const payload = tlv("00", "01") + tlv("01", "12") + tlv("26", merchant) + tlv("52", "0000") + tlv("53", "986") +
    tlv("54", amount.toFixed(2)) + tlv("58", "BR") + tlv("59", cleanName) + tlv("60", cleanCity) + tlv("62", additional) + "6304";
  return payload + crc16(payload);
};

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

    const { data: paymentSettings, error: settingsError } = await admin.from("mobflow_payment_settings")
      .select("pix_key,recipient_name,recipient_city,monthly_price").eq("id", true).maybeSingle();
    if (settingsError || !paymentSettings?.pix_key) {
      return json({ error: "O cadastro está temporariamente indisponível para pagamento. Tente novamente mais tarde." }, 503);
    }
    const monthlyPrice = Number(paymentSettings.monthly_price) || 79.90;
    const pixCopyPaste = buildPixPayload(String(paymentSettings.pix_key), String(paymentSettings.recipient_name || "MOBFLOW"), String(paymentSettings.recipient_city || "SAO PAULO"), monthlyPrice);
    const pixQrCode = "https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=" + encodeURIComponent(pixCopyPaste);

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
      monthly_price: monthlyPrice,
      payment_method: "pix",
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
      paymentMethod: "pix",
      amount: monthlyPrice,
      pixCopyPaste,
      pixQrCode,
      pixRecipientName: paymentSettings.recipient_name,
      message: "Cadastro recebido. Pague via Pix e aguarde a conferência manual para liberar o acesso.",
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