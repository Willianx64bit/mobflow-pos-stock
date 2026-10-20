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
  const cleanName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9 .&-]/gi, "").toUpperCase().slice(0, 25) || "MOBFLOW";
  const cleanCity = city.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9 .-]/gi, "").toUpperCase().slice(0, 15) || "SAO PAULO";
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
  let allowlistCreated = false;
  let allowlistUsername = "";
  try {
    const body = await req.json();
    if (body.action === "submit_payment_proof") {
      const requestToken = String(body.requestToken ?? "");
      const mimeType = String(body.mimeType ?? "");
      const base64 = String(body.fileBase64 ?? "");
      const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
      if (!/^[0-9a-f-]{36}$/i.test(requestToken)) return json({ error: "Solicitação inválida. Refaça o cadastro." }, 400);
      if (!allowedTypes.includes(mimeType)) return json({ error: "Envie uma imagem JPG, PNG, WEBP ou um PDF." }, 400);
      if (!base64 || base64.length > 7_000_000) return json({ error: "O comprovante deve ter até 5 MB." }, 400);
      const url = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!url || !serviceKey) return json({ error: "Envio de comprovante temporariamente indisponível." }, 503);
      const proofAdmin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: company, error: companyLookupError } = await proofAdmin.from("companies")
        .select("account_id,subscription_status,payment_proof_path").eq("payment_request_token", requestToken).maybeSingle();
      if (companyLookupError || !company) return json({ error: "Solicitação não encontrada. Confira o cadastro." }, 404);
      if (company.subscription_status === "active") return json({ error: "Esta conta já está ativa." }, 409);
      const binary = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      if (binary.byteLength > 5 * 1024 * 1024) return json({ error: "O comprovante deve ter até 5 MB." }, 400);
      const ext = mimeType === "application/pdf" ? "pdf" : mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
      const path = requestToken + "/" + crypto.randomUUID() + "." + ext;
      const { error: uploadError } = await proofAdmin.storage.from("mobflow-payment-proofs").upload(path, binary, { contentType: mimeType, upsert: false });
      if (uploadError) {
        console.error("mobflow proof upload failed", uploadError.message);
        return json({ error: "Não foi possível enviar o comprovante. Tente novamente." }, 500);
      }
      const { error: updateError } = await proofAdmin.from("companies").update({
        payment_proof_path: path,
        payment_submitted_at: new Date().toISOString(),
        subscription_status: "pending_payment",
      }).eq("payment_request_token", requestToken);
      if (updateError) {
        await proofAdmin.storage.from("mobflow-payment-proofs").remove([path]);
        console.error("mobflow proof metadata update failed", updateError.message);
        return json({ error: "O arquivo foi recebido, mas não foi possível registrar a solicitação." }, 500);
      }
      return json({ ok: true, message: "Solicitação enviada. Aguarde a análise do administrador." });
    }

    if (body.action === "complete_manager_setup") {
      const cnpjSetup = cleanDigits(body.cnpj);
      const setupToken = String(body.setupToken ?? "");
      const setupUsername = normalizeUsername(body.username);
      const setupPassword = String(body.password ?? "");
      if (cnpjSetup.length !== 14 || !/^[0-9a-f-]{36}$/i.test(setupToken)) return json({ error: "Dados de primeiro acesso inválidos." }, 400);
      if (!/^[A-Z0-9._-]{3,40}$/.test(setupUsername)) return json({ error: "O usuário deve ter de 3 a 40 caracteres: letras, números, ponto, hífen ou underline." }, 400);
      if (setupPassword.length < 8 || setupPassword.length > 128) return json({ error: "A senha precisa ter pelo menos 8 caracteres." }, 400);
      const setupUrl = Deno.env.get("SUPABASE_URL");
      const setupKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!setupUrl || !setupKey) return json({ error: "Primeiro acesso temporariamente indisponível." }, 503);
      const setupAdmin = createClient(setupUrl, setupKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: company, error: companyError } = await setupAdmin.from("companies")
        .select("account_id,cnpj,company_name,manager_setup_token,manager_setup_completed_at")
        .eq("cnpj", cnpjSetup).eq("manager_setup_token", setupToken).maybeSingle();
      if (companyError || !company || company.manager_setup_completed_at) return json({ error: "Link de primeiro acesso inválido ou já utilizado." }, 409);
      const { data: existingProfile } = await setupAdmin.from("profiles").select("id").eq("username", setupUsername).maybeSingle();
      if (existingProfile) return json({ error: "Esse nome de usuário já está em uso." }, 409);
      const authEmail = setupUsername.toLowerCase().replace(/[^a-z0-9._-]/g, "-") + "@accounts.mobflow.local";
      const { error: authUpdateError } = await setupAdmin.auth.admin.updateUserById(company.account_id, {
        email: authEmail, password: setupPassword, email_confirm: true,
        user_metadata: { username: setupUsername, role: "manager", mobflow_signup: "public_signup" },
      });
      if (authUpdateError) return json({ error: "Não foi possível configurar o acesso. Tente novamente." }, 500);
      const { error: profileInsertError } = await setupAdmin.from("profiles").insert({
        id: company.account_id, username: setupUsername, cnpj: cnpjSetup, account_id: company.account_id,
        role: "manager", active: true, display_name: company.company_name,
        permissions: ["PDV", "Conferência", "Validade", "Fiado", "Gerência"],
      });
      if (profileInsertError) {
        console.error("mobflow first manager profile insert failed", profileInsertError.message);
        return json({ error: profileInsertError.code === "23505" ? "Esse nome de usuário já está em uso." : "Não foi possível preparar o acesso. Tente novamente." }, profileInsertError.code === "23505" ? 409 : 500);
      }
      const { error: companyUpdateError } = await setupAdmin.from("companies").update({
        username: setupUsername, manager_setup_token: null, manager_setup_completed_at: new Date().toISOString(),
      }).eq("account_id", company.account_id).eq("manager_setup_token", setupToken);
      if (companyUpdateError) {
        await setupAdmin.from("profiles").delete().eq("id", company.account_id);
        console.error("mobflow first manager company update failed", companyUpdateError.message);
        return json({ error: "Não foi possível finalizar o primeiro acesso. Tente novamente." }, 500);
      }
      return json({ ok: true, message: "Acesso do gerente configurado. O pagamento ainda depende da aprovação manual." });
    }

    const companyName = String(body.companyName ?? "").trim();
    const username = normalizeUsername(body.username);
    const password = String(body.password ?? "");
    const cnpj = cleanDigits(body.cnpj);
    const phone = cleanDigits(body.phone);
    const email = String(body.email ?? "").trim().toLowerCase();

    if (companyName.length < 2 || companyName.length > 120) {
      return json({ error: "Informe o nome da empresa (2 a 120 caracteres)." }, 400);
    }
    if (cnpj.length !== 14) return json({ error: "Informe um CNPJ com 14 números." }, 400);
    if (!/^[A-Z0-9._-]{3,40}$/.test(username)) return json({ error: "O usuário do gerente deve ter de 3 a 40 caracteres: letras, números, ponto, hífen ou underline." }, 400);
    if (password.length < 8 || password.length > 128) return json({ error: "A senha do gerente precisa ter pelo menos 8 caracteres." }, 400);
    if (phone.length < 10 || phone.length > 13) return json({ error: "Informe um telefone válido com DDD." }, 400);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Informe um e-mail válido." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "Cadastro temporariamente indisponível." }, 503);
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const billingResponse = await fetch("https://xsitutjpdshmidzpgxpx.supabase.co/functions/v1/mobflow-public-billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!billingResponse.ok) {
      console.error("mobflow signup billing config failed", billingResponse.status);
      return json({ error: "O cadastro está temporariamente indisponível para pagamento. Tente novamente mais tarde." }, 503);
    }
    const paymentSettings = await billingResponse.json();
    const pixKey = String(paymentSettings.pix_phone ?? "").trim();
    const monthlyPrice = Number(paymentSettings.monthly_price);
    if (paymentSettings.ok !== true || !/^\+?\d{10,15}$/.test(pixKey) || !Number.isFinite(monthlyPrice) || monthlyPrice <= 0) {
      return json({ error: "As configurações Pix ainda não estão disponíveis. Tente novamente mais tarde." }, 503);
    }
    const pixCopyPaste = buildPixPayload(pixKey, String(paymentSettings.recipient_name || "MOBFLOW"), String(paymentSettings.recipient_city || "SAO PAULO"), monthlyPrice);
    const pixQrCode = "https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=" + encodeURIComponent(pixCopyPaste);

    const { data: existingCnpj } = await admin.from("companies").select("account_id").eq("cnpj", cnpj).maybeSingle();
    if (existingCnpj) return json({ error: "Já existe um cadastro com esse CNPJ." }, 409);
    const { data: existingEmail } = await admin.from("companies").select("account_id").ilike("email", email).maybeSingle();
    if (existingEmail) return json({ error: "Já existe um cadastro com esse e-mail." }, 409);
    const { data: existingUsername, error: usernameCheckError } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
    if (usernameCheckError) {
      console.error("mobflow-signup username check failed", usernameCheckError.message);
      return json({ error: "Não foi possível validar o usuário agora. Tente novamente." }, 500);
    }
    if (existingUsername) return json({ error: "Esse nome de usuário já está em uso." }, 409);

    const { data: existingAllowlist, error: allowlistCheckError } = await admin.from("account_allowlist")
      .select("username").eq("username", username).maybeSingle();
    if (allowlistCheckError) {
      console.error("mobflow-signup allowlist check failed", allowlistCheckError.message);
      return json({ error: "Não foi possível validar o usuário agora. Tente novamente." }, 500);
    }
    if (existingAllowlist) return json({ error: "Esse nome de usuário já está em uso." }, 409);

    const { error: allowlistInsertError } = await admin.from("account_allowlist").insert({ username, cnpj, active: true });
    if (allowlistInsertError) {
      console.error("mobflow-signup allowlist insert failed", allowlistInsertError.message);
      return json({ error: allowlistInsertError.code === "23505" ? "Esse nome de usuário já está em uso." : "Não foi possível preparar o cadastro." }, allowlistInsertError.code === "23505" ? 409 : 500);
    }
    allowlistCreated = true;
    allowlistUsername = username;

    const authEmail = username.toLowerCase() + "@accounts.mobflow.local";
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: { username, role: "manager", mobflow_signup: "public_signup" },
    });
    if (createError || !created.user) {
      await admin.from("account_allowlist").delete().eq("username", username);
      allowlistCreated = false;
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
      manager_setup_token: null,
      manager_setup_completed_at: new Date().toISOString(),
      email,
      phone,
      plan_code: "complete",
      monthly_price: monthlyPrice,
      payment_method: "pix",
      subscription_status: "pending_payment",
    });
    if (companyError) {
      await admin.auth.admin.deleteUser(created.user.id);
      await admin.from("account_allowlist").delete().eq("username", username);
      allowlistCreated = false;
      createdUserId = null;
      if (companyError.code === "23505") return json({ error: "Já existe um cadastro com esse CNPJ, usuário ou e-mail." }, 409);
      console.error("mobflow-signup company insert failed", companyError.message);
      return json({ error: "Não foi possível salvar os dados da empresa." }, 500);
    }

    const { error: profileInsertError } = await admin.from("profiles").insert({
      id: created.user.id,
      username,
      cnpj,
      account_id: created.user.id,
      role: "manager",
      active: true,
      display_name: companyName,
      permissions: ["PDV", "Conferência", "Validade", "Fiado", "Gerência"],
    });
    if (profileInsertError) {
      await admin.from("companies").delete().eq("account_id", created.user.id);
      await admin.auth.admin.deleteUser(created.user.id);
      await admin.from("account_allowlist").delete().eq("username", username);
      allowlistCreated = false;
      createdUserId = null;
      console.error("mobflow-signup manager profile insert failed", profileInsertError.message);
      return json({ error: profileInsertError.code === "23505" ? "Esse nome de usuário já está em uso." : "Não foi possível criar o acesso do gerente." }, profileInsertError.code === "23505" ? 409 : 500);
    }

    const { data: paymentRequest, error: requestTokenError } = await admin.from("companies")
      .select("payment_request_token").eq("account_id", created.user.id).single();
    if (requestTokenError || !paymentRequest?.payment_request_token) {
      await admin.from("companies").delete().eq("account_id", created.user.id);
      await admin.auth.admin.deleteUser(created.user.id);
      await admin.from("account_allowlist").delete().eq("username", username);
      allowlistCreated = false;
      createdUserId = null;
      console.error("mobflow-signup request token fetch failed", requestTokenError?.message);
      return json({ error: "Não foi possível preparar a solicitação de pagamento." }, 500);
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
      await admin.from("account_allowlist").delete().eq("username", username);
      allowlistCreated = false;
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
      pixRecipientName: paymentSettings.recipient_name || "MOBFLOW",
      requestToken: paymentRequest.payment_request_token,
      username,
      message: "Cadastro criado com acesso de gerente. Aguarde a aprovação manual do pagamento.",
    }, 201);
  } catch (error) {
    console.error("mobflow-signup unexpected error", error);
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && serviceKey) {
      const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
      if (createdUserId) {
        await admin.from("profiles").delete().eq("id", createdUserId);
        await admin.from("companies").delete().eq("account_id", createdUserId);
        await admin.from("app_state").delete().eq("owner_id", createdUserId);
        await admin.auth.admin.deleteUser(createdUserId);
      }
      if (allowlistCreated && allowlistUsername) await admin.from("account_allowlist").delete().eq("username", allowlistUsername);
    }
    return json({ error: "Não foi possível concluir o cadastro agora." }, 500);
  }
});