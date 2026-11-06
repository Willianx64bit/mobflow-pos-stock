import { createFileRoute } from "@tanstack/react-router";
import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { getNeonPool } from "@/lib/server/neon";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const genericMessage = "Se os dados corresponderem à conta da Gerência, enviaremos um link para o e-mail cadastrado. Verifique a caixa de entrada e o spam.";
const genericResponse = () => Response.json({ ok: true, message: genericMessage });

async function requestRecovery(body: Record<string, unknown>) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const cnpj = String(body.cnpj ?? "").replace(/\D/g, "");
  if (!email || !email.includes("@") || cnpj.length !== 14) {
    return Response.json({ ok: false, error: "Informe um e-mail válido e o CNPJ completo da empresa." }, { status: 400 });
  }

  const smtpHost = process.env.GMAIL_SMTP_HOST;
  const smtpPort = Number(process.env.GMAIL_SMTP_PORT || "465");
  const smtpUser = process.env.GMAIL_SMTP_USER;
  const smtpPassword = process.env.GMAIL_SMTP_APP_PASSWORD;
  if (!smtpHost || !smtpUser || !smtpPassword || smtpPort !== 465) {
    return Response.json({ ok: false, error: "O envio de e-mail ainda não está configurado. Tente novamente mais tarde." }, { status: 503 });
  }

  const client = await getNeonPool().connect();
  try {
    const match = await client.query<{ account_id: string }>(
      `SELECT p.account_id::text
       FROM public.profiles p
       JOIN public.companies c ON c.account_id=p.account_id
       WHERE p.cnpj=$1 AND p.role='manager' AND p.active=true AND lower(trim(c.email))=$2
       ORDER BY p.created_at DESC LIMIT 1`,
      [cnpj, email],
    );
    const accountId = match.rows[0]?.account_id;
    if (!accountId) return genericResponse();

    const rate = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM public.manager_password_recovery_tokens
       WHERE account_id=$1 AND created_at >= now() - interval '1 hour'`,
      [accountId],
    );
    if ((rate.rows[0]?.total ?? 0) >= 3) return genericResponse();

    const token = randomBytes(32).toString("hex");
    const tokenHash = sha256(token);
    await client.query(
      `INSERT INTO public.manager_password_recovery_tokens (account_id,token_hash,expires_at)
       VALUES ($1,$2,now() + interval '30 minutes')`,
      [accountId, tokenHash],
    );

    const baseUrl = (process.env.MOBFLOW_APP_URL || "https://mobflow-pos-stock.vercel.app").replace(/\/+$/, "");
    const resetUrl = baseUrl + "/recuperar-senha?token=" + encodeURIComponent(token);
    try {
      const transport = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: true,
        auth: { user: smtpUser, pass: smtpPassword },
      });
      await transport.sendMail({
        from: "MobFlow <" + smtpUser + ">",
        to: email,
        subject: "Recuperação da senha da Gerência — MobFlow",
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222">
<h2>Recuperar senha da Gerência</h2>
<p>Recebemos uma solicitação para criar uma nova senha da Gerência da sua empresa no MobFlow.</p>
<p>O link é válido por 30 minutos e pode ser usado uma única vez.</p>
<p style="margin:28px 0"><a href="\${resetUrl}" style="background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Criar nova senha</a></p>
<p>Se você não solicitou essa alteração, ignore este e-mail. Sua senha atual continuará funcionando.</p>
</div>`,
      });
    } catch (error) {
      await client.query(
        "UPDATE public.manager_password_recovery_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL",
        [tokenHash],
      );
      console.error("[MobFlow recovery email]", error instanceof Error ? error.message : "SMTP error");
      return Response.json({ ok: false, error: "Não foi possível enviar o e-mail. Verifique a configuração do serviço de e-mail." }, { status: 502 });
    }
    return genericResponse();
  } finally {
    client.release();
  }
}

async function resetRecovery(body: Record<string, unknown>) {
  const token = String(body.token ?? "").trim();
  const password = String(body.password ?? "");
  if (!token || token.length > 200) {
    return Response.json({ ok: false, error: "Link de recuperação inválido ou expirado." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ ok: false, error: "A nova senha precisa ter pelo menos 8 caracteres." }, { status: 400 });
  }

  const client = await getNeonPool().connect();
  try {
    await client.query("BEGIN");
    const tokenHash = sha256(token);
    const result = await client.query<{
      id: string; account_id: string; expires_at: Date | string; used_at: Date | null;
    }>(
      `SELECT id::text,account_id::text,expires_at,used_at
       FROM public.manager_password_recovery_tokens
       WHERE token_hash=$1 FOR UPDATE`,
      [tokenHash],
    );
    const recovery = result.rows[0];
    if (!recovery || recovery.used_at || new Date(recovery.expires_at).getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return Response.json({ ok: false, error: "Link de recuperação inválido ou expirado. Solicite um novo link." }, { status: 400 });
    }

    const claimed = await client.query(
      `UPDATE public.manager_password_recovery_tokens
       SET used_at=now()
       WHERE id=$1 AND used_at IS NULL AND expires_at>now()
       RETURNING id`,
      [recovery.id],
    );
    if (!claimed.rowCount) {
      await client.query("ROLLBACK");
      return Response.json({ ok: false, error: "Este link já foi usado ou expirou. Solicite um novo link." }, { status: 400 });
    }

    await client.query(
      `INSERT INTO public.manager_security_by_account (account_id,password_hash,updated_at)
       VALUES ($1,$2,now())
       ON CONFLICT (account_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,updated_at=now()`,
      [recovery.account_id, sha256(password)],
    );
    await client.query("COMMIT");
    return Response.json({ ok: true, message: "Senha da Gerência alterada. Agora você já pode entrar com a nova senha." });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[MobFlow recovery reset]", error instanceof Error ? error.message : "unknown error");
    return Response.json({ ok: false, error: "Não foi possível concluir a recuperação agora." }, { status: 500 });
  } finally {
    client.release();
  }
}

async function handleRecovery(request: Request) {
  if (process.env.MOBFLOW_AUTH_PROVIDER !== "better-auth") {
    return Response.json({ ok: false, error: "Este fluxo ainda não está ativo neste ambiente." }, { status: 503 });
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: "Solicitação inválida." }, { status: 400 });
  }
  const action = String(body.action ?? "");
  if (action === "request") return requestRecovery(body);
  if (action === "reset") return resetRecovery(body);
  return Response.json({ ok: false, error: "Ação inválida." }, { status: 400 });
}

export const Route = createFileRoute("/api/mobflow/manager-password-recovery")({
  server: { handlers: { POST: ({ request }) => handleRecovery(request) } },
});
