import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getNeonPool } from "@/lib/server/neon";

const SUPABASE_URL = process.env.MOBFLOW_SUPABASE_URL || "https://ezkwubdpblqkdfampopa.supabase.co";
const STORAGE_BUCKET = "mobflow-payment-proofs";
const MANAGER_PERMISSIONS = ["PDV", "Conferência", "Validade", "Fiado", "Gerência"];
const R2_ACCOUNT_ID = process.env["CLOUDFLARE_R2_ACCOUNT_ID"]?.trim() ?? "";
const R2_ACCESS_KEY_ID = process.env["CLOUDFLARE_R2_ACCESS_KEY_ID"]?.trim() ?? "";
const R2_SECRET_ACCESS_KEY = process.env["CLOUDFLARE_R2_SECRET_ACCESS_KEY"]?.trim() ?? "";
const R2_BUCKET_NAME = process.env["CLOUDFLARE_R2_BUCKET_NAME"]?.trim() ?? "";
let r2Client: S3Client | null = null;

function getR2Storage() {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) return null;
  if (!r2Client) {
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });
  }
  return { client: r2Client, bucket: R2_BUCKET_NAME };
}

function hasValidFileSignature(bytes: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mimeType === "image/webp") return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (mimeType === "application/pdf") return bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-";
  return false;
}

const cleanDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const normalizeUsername = (value: unknown) => String(value ?? "").trim().toUpperCase();
const authEmail = (username: string) => username.toLowerCase().replace(/[^a-z0-9._-]/g, "-") + "@accounts.mobflow.local";
const tlv = (id: string, value: string) => id + String(value.length).padStart(2, "0") + value;

function crc16(input: string) {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function buildPixPayload(key: string, name: string, city: string, amount: number) {
  const cleanName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9 .&-]/gi, "").toUpperCase().slice(0, 25) || "MOBFLOW";
  const cleanCity = city.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9 .-]/gi, "").toUpperCase().slice(0, 15) || "SAO PAULO";
  const merchant = tlv("00", "BR.GOV.BCB.PIX") + tlv("01", key);
  const payload = tlv("00", "01") + tlv("01", "12") + tlv("26", merchant) + tlv("52", "0000") +
    tlv("53", "986") + tlv("54", amount.toFixed(2)) + tlv("58", "BR") +
    tlv("59", cleanName) + tlv("60", cleanCity) + tlv("62", tlv("05", "***")) + "6304";
  return payload + crc16(payload);
}

function errorResponse(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

async function submitPaymentProof(body: Record<string, unknown>) {
  const requestToken = String(body.requestToken ?? "");
  const mimeType = String(body.mimeType ?? "");
  const base64 = String(body.fileBase64 ?? "");
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!/^[0-9a-f-]{36}$/i.test(requestToken)) return errorResponse("Solicitação inválida. Refaça o cadastro.");
  if (!allowedTypes.includes(mimeType)) return errorResponse("Envie uma imagem JPG, PNG, WEBP ou um PDF.");
  if (!base64 || base64.length > 7_000_000) return errorResponse("O comprovante deve ter até 5 MB.");

  const r2EnvCount = [R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME].filter(Boolean).length;
  if (r2EnvCount > 0 && r2EnvCount < 4) {
    return errorResponse("Armazenamento R2 incompleto neste ambiente. Configure as quatro variáveis do Preview.", 503);
  }
  const r2 = getR2Storage();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!r2 && !serviceKey) return errorResponse("Armazenamento de comprovantes não configurado neste ambiente.", 503);

  const client = await getNeonPool().connect();
  let path = "";
  let storageAdmin: ReturnType<typeof createClient> | null = null;
  try {
    const companyResult = await client.query<{ account_id: string; subscription_status: string }>(
      "SELECT account_id::text,subscription_status FROM public.companies WHERE payment_request_token=$1 LIMIT 1",
      [requestToken],
    );
    const company = companyResult.rows[0];
    if (!company) return errorResponse("Solicitação não encontrada. Confira o cadastro.", 404);
    if (company.subscription_status === "active") return errorResponse("Esta conta já está ativa.", 409);

    const bytes = Buffer.from(base64, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024) return errorResponse("O comprovante deve ter até 5 MB.");
    if (!hasValidFileSignature(bytes, mimeType)) return errorResponse("O arquivo não corresponde ao formato informado.");

    const extension = mimeType === "application/pdf" ? "pdf" : mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    if (r2) {
      const now = new Date();
      path = `tenants/${company.account_id}/pix-proofs/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,"0")}/${randomUUID()}.${extension}`;
      await r2.client.send(new PutObjectCommand({
        Bucket: r2.bucket,
        Key: path,
        Body: bytes,
        ContentLength: bytes.byteLength,
        ContentType: mimeType,
        CacheControl: "private, no-store",
        Metadata: { purpose: "pix-proof", requesttoken: requestToken },
      }));
    } else {
      // Temporary compatibility path for environments not yet provisioned with R2.
      path = requestToken + "/" + randomUUID() + "." + extension;
      storageAdmin = createClient(SUPABASE_URL, serviceKey!, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: uploadError } = await storageAdmin.storage.from(STORAGE_BUCKET).upload(path, bytes, {
        contentType: mimeType,
        upsert: false,
      });
      if (uploadError) {
        console.error("[MobFlow payment proof upload]", uploadError.message);
        return errorResponse("Não foi possível enviar o comprovante. Tente novamente.", 500);
      }
    }

    const update = await client.query(
      `UPDATE public.companies
       SET payment_proof_path=$2,payment_submitted_at=now(),subscription_status='pending_payment',updated_at=now()
       WHERE payment_request_token=$1 AND subscription_status <> 'active'`,
      [requestToken, path],
    );
    if (!update.rowCount) {
      if (r2) await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: path })).catch(() => undefined);
      else if (storageAdmin) await storageAdmin.storage.from(STORAGE_BUCKET).remove([path]);
      return errorResponse("Não foi possível registrar o comprovante. Confira o status da solicitação.", 409);
    }
    return Response.json({ ok: true, message: "Solicitação enviada. Aguarde a análise do administrador." });
  } catch (error) {
    if (path && r2) await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: path })).catch(() => undefined);
    else if (path && storageAdmin) await storageAdmin.storage.from(STORAGE_BUCKET).remove([path]).catch(() => undefined);
    console.error("[MobFlow payment proof]", error instanceof Error ? error.message : "unknown error");
    return errorResponse("Não foi possível registrar o comprovante agora.", 500);
  } finally {
    client.release();
  }
}

async function completeManagerSetup(body: Record<string, unknown>) {
  const cnpj = cleanDigits(body.cnpj);
  const setupToken = String(body.setupToken ?? "");
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  if (cnpj.length !== 14 || !/^[0-9a-f-]{36}$/i.test(setupToken)) return errorResponse("Dados de primeiro acesso inválidos.");
  if (!/^[A-Z0-9._-]{3,40}$/.test(username)) return errorResponse("O usuário deve ter de 3 a 40 caracteres: letras, números, ponto, hífen ou underline.");
  if (password.length < 8 || password.length > 128) return errorResponse("A senha precisa ter pelo menos 8 caracteres.");

  const client = await getNeonPool().connect();
  try {
    await client.query("BEGIN");
    const companyResult = await client.query<{ account_id: string; company_name: string; manager_setup_completed_at: string | null }>(
      `SELECT account_id::text,company_name,manager_setup_completed_at
       FROM public.companies WHERE cnpj=$1 AND manager_setup_token=$2 LIMIT 1`,
      [cnpj, setupToken],
    );
    const company = companyResult.rows[0];
    if (!company || company.manager_setup_completed_at) {
      await client.query("ROLLBACK");
      return errorResponse("Link de primeiro acesso inválido ou já utilizado.", 409);
    }
    const duplicate = await client.query(
      "SELECT id FROM public.profiles WHERE username=$1 AND id<>$2 LIMIT 1",
      [username, company.account_id],
    );
    if (duplicate.rows.length) {
      await client.query("ROLLBACK");
      return errorResponse("Esse nome de usuário já está em uso.", 409);
    }
    const updatedUser = await client.query(
      `UPDATE public."user" SET email=$2,name=$3,"emailVerified"=true,"updatedAt"=now() WHERE id=$1`,
      [company.account_id, authEmail(username), username],
    );
    if (!updatedUser.rowCount) {
      await client.query("ROLLBACK");
      return errorResponse("Não foi possível localizar a conta do primeiro acesso.", 404);
    }
    await client.query(
      `UPDATE public."account" SET password=$2,"updatedAt"=now()
       WHERE "userId"=$1 AND "providerId"='credential' AND "accountId"=$1`,
      [company.account_id, await bcrypt.hash(password, 12)],
    );
    await client.query('DELETE FROM public."session" WHERE "userId"=$1', [company.account_id]);
    await client.query(
      `UPDATE public.profiles SET username=$2,display_name=$3,permissions=$4::jsonb
       WHERE id=$1`,
      [company.account_id, username, company.company_name, JSON.stringify(MANAGER_PERMISSIONS)],
    );
    await client.query(
      `UPDATE public.companies SET username=$2,manager_setup_token=NULL,manager_setup_completed_at=now(),updated_at=now()
       WHERE account_id=$1 AND manager_setup_token=$3`,
      [company.account_id, username, setupToken],
    );
    await client.query("COMMIT");
    return Response.json({ ok: true, message: "Acesso do gerente configurado. O pagamento ainda depende da aprovação manual." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[MobFlow manager setup]", error instanceof Error ? error.message : "unknown error");
    return errorResponse("Não foi possível concluir o primeiro acesso.", 500);
  } finally {
    client.release();
  }
}

async function createCompany(body: Record<string, unknown>) {
  const companyName = String(body.companyName ?? "").trim();
  const username = normalizeUsername(body.username);
  const password = String(body.password ?? "");
  const cnpj = cleanDigits(body.cnpj);
  const phone = cleanDigits(body.phone);
  const email = String(body.email ?? "").trim().toLowerCase();

  if (companyName.length < 2 || companyName.length > 120) return errorResponse("Informe o nome da empresa (2 a 120 caracteres).");
  if (cnpj.length !== 14) return errorResponse("Informe um CNPJ com 14 números.");
  if (!/^[A-Z0-9._-]{3,40}$/.test(username)) return errorResponse("O usuário do gerente deve ter de 3 a 40 caracteres: letras, números, ponto, hífen ou underline.");
  if (password.length < 8 || password.length > 128) return errorResponse("A senha do gerente precisa ter pelo menos 8 caracteres.");
  if (phone.length < 10 || phone.length > 13) return errorResponse("Informe um telefone válido com DDD.");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorResponse("Informe um e-mail válido.");

  let paymentSettings: { pix_phone: string; monthly_price: number; payment_method: "pix"; recipient_name: string; recipient_city: string };
  try {
    const billingResult = await getNeonPool().query<{
      pix_phone: string;
      monthly_price: string | number;
      payment_method: string;
    }>(
      "SELECT pix_phone, monthly_price, payment_method FROM public.admin_billing_settings WHERE id = true LIMIT 1",
    );
    const billing = billingResult.rows[0];
    const pixKey = String(billing?.pix_phone ?? "").trim();
    const monthlyPrice = Number(billing?.monthly_price);
    if (!billing || billing.payment_method !== "pix" || !/^\+?\d{10,15}$/.test(pixKey) ||
        !Number.isFinite(monthlyPrice) || monthlyPrice <= 0) {
      return errorResponse("As configurações Pix ainda não estão disponíveis. Tente novamente mais tarde.", 503);
    }
    paymentSettings = {
      pix_phone: pixKey,
      monthly_price: monthlyPrice,
      payment_method: "pix",
      recipient_name: "MOBFLOW",
      recipient_city: "CAPAO BONITO",
    };
  } catch (error) {
    console.error("[MobFlow billing settings]", error instanceof Error ? error.message : "unknown error");
    return errorResponse("Não foi possível consultar as configurações de cobrança. Tente novamente mais tarde.", 503);
  }
  const pixKey = paymentSettings.pix_phone;
  const monthlyPrice = paymentSettings.monthly_price;

  const client = await getNeonPool().connect();
  try {
    await client.query("BEGIN");
    const duplicates = await client.query(
      `SELECT
        EXISTS(SELECT 1 FROM public.companies WHERE cnpj=$1) AS cnpj_exists,
        EXISTS(SELECT 1 FROM public.companies WHERE lower(email)=lower($2)) AS email_exists,
        EXISTS(SELECT 1 FROM public.profiles WHERE username=$3) AS username_exists,
        EXISTS(SELECT 1 FROM public.account_allowlist WHERE username=$3) AS allowlist_exists`,
      [cnpj, email, username],
    );
    const duplicate = duplicates.rows[0];
    if (duplicate.cnpj_exists) { await client.query("ROLLBACK"); return errorResponse("Já existe um cadastro com esse CNPJ.", 409); }
    if (duplicate.email_exists) { await client.query("ROLLBACK"); return errorResponse("Já existe um cadastro com esse e-mail.", 409); }
    if (duplicate.username_exists || duplicate.allowlist_exists) { await client.query("ROLLBACK"); return errorResponse("Esse nome de usuário já está em uso.", 409); }

    const id = randomUUID();
    const now = new Date();
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO public."user" (id,name,email,"emailVerified","createdAt","updatedAt")
       VALUES ($1,$2,$3,true,$4,$4)`,
      [id, username, authEmail(username), now],
    );
    await client.query(
      `INSERT INTO public."account" (id,"accountId","providerId","userId",password,"createdAt","updatedAt")
       VALUES ($1,$1,'credential',$1,$2,$3,$3)`,
      [id, passwordHash, now],
    );
    await client.query(
      `INSERT INTO public.profiles (id,username,cnpj,account_id,role,active,display_name,permissions)
       VALUES ($1,$2,$3,$1,'manager',true,$4,$5::jsonb)`,
      [id, username, cnpj, companyName, JSON.stringify(MANAGER_PERMISSIONS)],
    );
    await client.query(
      `INSERT INTO public.account_allowlist (username,cnpj,active) VALUES ($1,$2,true)`,
      [username, cnpj],
    );
    const companyResult = await client.query<{ payment_request_token: string }>(
      `INSERT INTO public.companies
        (account_id,company_name,cnpj,username,manager_setup_token,manager_setup_completed_at,
         email,phone,plan_code,monthly_price,payment_method,subscription_status)
       VALUES ($1,$2,$3,$4,NULL,now(),$5,$6,'complete',$7,'pix','pending_payment')
       RETURNING payment_request_token::text`,
      [id, companyName, cnpj, username, email, phone, monthlyPrice],
    );
    const requestToken = companyResult.rows[0]?.payment_request_token;
    if (!requestToken) throw new Error("payment_request_token missing");

    const initialState = {
      products: [], cart: [], sales: [], conferences: [], receiving: [],
      manualExpiries: [], promotions: [], suppliers: [], settings: { companyName },
    };
    await client.query(
      "INSERT INTO public.app_state (owner_id,state,updated_at) VALUES ($1,$2::jsonb,now())",
      [id, JSON.stringify(initialState)],
    );
    await client.query("COMMIT");

    const pixCopyPaste = buildPixPayload(
      pixKey,
      String(paymentSettings.recipient_name || "MOBFLOW"),
      String(paymentSettings.recipient_city || "SAO PAULO"),
      monthlyPrice,
    );
    const pixQrCode = "https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=" + encodeURIComponent(pixCopyPaste);
    return Response.json({
      ok: true,
      subscriptionStatus: "pending_payment",
      paymentMethod: "pix",
      amount: monthlyPrice,
      pixCopyPaste,
      pixQrCode,
      pixRecipientName: paymentSettings.recipient_name || "MOBFLOW",
      requestToken,
      username,
      message: "Cadastro criado com acesso de gerente. Aguarde a aprovação manual do pagamento.",
    }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string })?.code === "23505") return errorResponse("Já existe um cadastro com esse CNPJ, usuário ou e-mail.", 409);
    console.error("[MobFlow company signup]", error instanceof Error ? error.message : "unknown error");
    return errorResponse("Não foi possível concluir o cadastro agora.", 500);
  } finally {
    client.release();
  }
}

async function handleSignup(request: Request) {
  if (process.env.MOBFLOW_AUTH_PROVIDER !== "better-auth") {
    return errorResponse("Este fluxo ainda não está ativo neste ambiente.", 503);
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return errorResponse("Solicitação inválida."); }
  if (body.action === "submit_payment_proof") return submitPaymentProof(body);
  if (body.action === "complete_manager_setup") return completeManagerSetup(body);
  return createCompany(body);
}

async function getPublicBillingSettings() {
  try {
    const result = await getNeonPool().query<{
      monthly_price: string | number;
      payment_method: string;
    }>("SELECT monthly_price,payment_method FROM public.admin_billing_settings WHERE id=true LIMIT 1");
    const settings = result.rows[0];
    const monthlyPrice = Number(settings?.monthly_price);
    if (!settings || settings.payment_method !== "pix" || !Number.isFinite(monthlyPrice) || monthlyPrice <= 0) {
      return Response.json({ ok: false, error: "Configuração de cobrança indisponível." }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json({ ok: true, monthly_price: monthlyPrice, payment_method: "pix" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[MobFlow public billing settings]", error instanceof Error ? error.message : "unknown error");
    return Response.json({ ok: false, error: "Configuração de cobrança indisponível." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export const Route = createFileRoute("/api/mobflow/signup")({
  server: {
    handlers: {
      GET: () => getPublicBillingSettings(),
      POST: ({ request }) => handleSignup(request),
    },
  },
});
