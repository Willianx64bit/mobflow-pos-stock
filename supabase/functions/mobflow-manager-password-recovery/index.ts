
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@7.0.10";

const cors = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
new Response(JSON.stringify(body), {
status,
headers: { ...cors, "Content-Type": "application/json" },
});

async function sha256(value: string) {
const digest = await crypto.subtle.digest(
"SHA-256",
new TextEncoder().encode(value),
);
return Array.from(new Uint8Array(digest))
.map((b) => b.toString(16).padStart(2, "0"))
.join("");
}

function randomToken() {
const bytes = crypto.getRandomValues(new Uint8Array(32));
return Array.from(bytes)
.map((b) => b.toString(16).padStart(2, "0"))
.join("");
}

Deno.serve(async (req) => {
if (req.method === "OPTIONS") {
return new Response("ok", { headers: cors });
}

if (req.method !== "POST") {
return json({ error: "Método não permitido." }, 405);
}

try {
const body = await req.json();
const action = String(body.action ?? "");
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(url, serviceKey, {
auth: { autoRefreshToken: false, persistSession: false },
});

if (action === "request") {
const email = String(body.email ?? "").trim().toLowerCase();

// Corrigido: remove todos os caracteres que não sejam números.
const cnpj = String(body.cnpj ?? "").replace(/\D/g, "");

if (!email || !email.includes("@") || cnpj.length !== 14) {
return json({
error: "Informe um e-mail válido e o CNPJ completo da empresa.",
}, 400);
}

const genericResponse = () =>
json({
ok: true,
message:
"Se os dados corresponderem à conta da Gerência, enviaremos um link para o e-mail cadastrado. Verifique a caixa de entrada e o spam.",
});

const { data: profiles, error: profileError } = await admin
.from("profiles")
.select("id,account_id,cnpj,role,active")
.eq("cnpj", cnpj)
.eq("role", "manager")
.eq("active", true)
.limit(10);

if (profileError) {
console.error("Recovery profile lookup failed", profileError);
return json({
error: "Não foi possível processar a solicitação agora. Tente novamente mais tarde.",
}, 500);
}

const candidates = profiles ?? [];
let matchingProfile: { id: string; account_id: string } | null = null;

for (const profile of candidates) {
if (!profile.account_id) continue;

const { data: company, error: companyError } = await admin
.from("companies")
.select("email")
.eq("account_id", profile.account_id)
.maybeSingle();

if (companyError) {
console.error("Recovery company lookup failed", companyError);
return json({
error: "Não foi possível processar a solicitação agora. Tente novamente mais tarde.",
}, 500);
}

if (
String(company?.email ?? "").trim().toLowerCase() === email
) {
matchingProfile = {
id: profile.id,
account_id: profile.account_id,
};
break;
}
}

if (!matchingProfile) return genericResponse();

const { data: recentTokens, error: rateError } = await admin
.from("manager_password_recovery_tokens")
.select("id")
.eq("account_id", matchingProfile.account_id)
.gte(
"created_at",
new Date(Date.now() - 60 * 60 * 1000).toISOString(),
)
.limit(3);

if (rateError) {
console.error("Recovery rate check failed", rateError);
return json({
error: "Não foi possível processar a solicitação agora. Tente novamente mais tarde.",
}, 500);
}

if ((recentTokens ?? []).length >= 3) return genericResponse();

const smtpHost = Deno.env.get("GMAIL_SMTP_HOST");
const smtpPort = Number(Deno.env.get("GMAIL_SMTP_PORT") || "465");
const smtpUser = Deno.env.get("GMAIL_SMTP_USER");
const smtpPassword = Deno.env.get("GMAIL_SMTP_APP_PASSWORD");

if (!smtpHost || !smtpUser || !smtpPassword || smtpPort !== 465) {
console.error("Gmail SMTP recovery email is not configured.");
return json({
error: "O envio de e-mail ainda não está configurado. Tente novamente mais tarde.",
}, 503);
}

const token = randomToken();
const tokenHash = await sha256(token);

const { error: insertError } = await admin
.from("manager_password_recovery_tokens")
.insert({
account_id: matchingProfile.account_id,
token_hash: tokenHash,
expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
});

if (insertError) {
console.error("Recovery token insert failed", insertError);
return json({
error: "Não foi possível processar a solicitação agora. Tente novamente mais tarde.",
}, 500);
}

const baseUrl =
Deno.env.get("MOBFLOW_APP_URL") ||
"https://mobflow-pos-stock.lovable.app";

const cleanBaseUrl = baseUrl.endsWith("/")
? baseUrl.slice(0, -1)
: baseUrl;

const resetUrl =
cleanBaseUrl + "/recuperar-senha?token=" + encodeURIComponent(token);

try {
const transport = nodemailer.createTransport({
host: smtpHost,
port: smtpPort,
secure: true,
auth: { user: smtpUser, pass: smtpPassword },
});
await transport.sendMail({
from: `MobFlow <${smtpUser}>`,
to: email,
subject: "Recuperação da senha da Gerência — MobFlow",
html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222">
<h2>Recuperar senha da Gerência</h2>
<p>Recebemos uma solicitação para criar uma nova senha da Gerência da sua empresa no MobFlow.</p>
<p>O link é válido por 30 minutos e pode ser usado uma única vez.</p>
<p style="margin:28px 0">
<a href="${resetUrl}" style="background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Criar nova senha</a>
</p>
<p>Se você não solicitou essa alteração, ignore este e-mail. Sua senha atual continuará funcionando.</p>
</div>`,
});
} catch (error) {
console.error("Gmail SMTP send failed", error);
return json({
error: "Não foi possível enviar o e-mail. Verifique a configuração do serviço de e-mail.",
}, 502);
}

return genericResponse();
}

if (action === "reset") {
const token = String(body.token ?? "").trim();
const password = String(body.password ?? "");

if (!token || token.length > 200) {
return json({
error: "Link de recuperação inválido ou expirado.",
}, 400);
}

if (password.length < 8) {
return json({
error: "A nova senha precisa ter pelo menos 8 caracteres.",
}, 400);
}

const tokenHash = await sha256(token);

const { data: recovery, error: recoveryError } = await admin
.from("manager_password_recovery_tokens")
.select("id,account_id,expires_at,used_at")
.eq("token_hash", tokenHash)
.maybeSingle();

if (recoveryError) {
console.error("Recovery token lookup failed", recoveryError);
return json({
error: "Não foi possível validar o link agora.",
}, 500);
}

if (
!recovery ||
recovery.used_at ||
new Date(recovery.expires_at).getTime() <= Date.now()
) {
return json({
error: "Link de recuperação inválido ou expirado. Solicite um novo link.",
}, 400);
}

const { data: claimed, error: claimError } = await admin
.from("manager_password_recovery_tokens")
.update({ used_at: new Date().toISOString() })
.eq("id", recovery.id)
.is("used_at", null)
.gt("expires_at", new Date().toISOString())
.select("id")
.maybeSingle();

if (claimError || !claimed) {
return json({
error: "Este link já foi usado ou expirou. Solicite um novo link.",
}, 400);
}

const passwordHash = await sha256(password);

const { error: passwordError } = await admin
.from("manager_security_by_account")
.upsert({
account_id: recovery.account_id,
password_hash: passwordHash,
updated_at: new Date().toISOString(),
}, { onConflict: "account_id" });

if (passwordError) {
console.error("Recovery password update failed", passwordError);
return json({
error: "Não foi possível salvar a nova senha. Solicite outro link e tente novamente.",
}, 500);
}

return json({
ok: true,
message: "Senha da Gerência alterada. Agora você já pode entrar com a nova senha.",
});
}

return json({ error: "Ação inválida." }, 400);
} catch (error) {
console.error("Manager password recovery error", error);
return json({
error: "Não foi possível concluir a recuperação agora.",
}, 500);
}
});
