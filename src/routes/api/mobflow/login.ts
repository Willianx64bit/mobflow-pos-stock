import { createFileRoute } from "@tanstack/react-router";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getNeonPool } from "@/lib/server/neon";
import {
  checkLoginSecurity,
  recordLoginFailure,
  recordLoginSuccess,
  recordLoginAuditEvent,
  verifyCompanyLoginCaptcha,
  acquireLoginAttemptLock,
  releaseLoginAttemptLock,
} from "@/lib/server/auth-security";

const MANAGER_PERMISSIONS = ["PDV", "Conferência", "Validade", "Fiado", "Gerência"];
const PDV_PERMISSIONS = ["PDV", "Conferência"];

class LoginError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSeconds = 0) { super(message); }
}
const deny = (message: string, status = 401): never => { throw new LoginError(message, status); };
const emailFor = (username: string) => username.toLowerCase().replace(/[^a-z0-9._-]/g, "-") + "@accounts.mobflow.local";

export async function handleMobFlowLogin(request: Request) {
  if (process.env["MOBFLOW_AUTH_PROVIDER"] !== "better-auth") {
    return Response.json({ ok: false, error: "Este fluxo ainda não está ativo neste ambiente." }, { status: 503 });
  }
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch {
    return Response.json({ ok: false, error: "Dados de acesso inválidos." }, { status: 400 });
  }
  const username = String(input["username"] ?? "").trim().toUpperCase();
  const password = String(input["password"] ?? "");
  const cnpj = String(input["cnpj"] ?? "").replace(/\D/g, "");
  const captchaToken = String(input["captchaToken"] ?? "");
  const expectedRole = input["expectedRole"] === "pdv" || (!input["expectedRole"] && !cnpj) ? "pdv" : "manager";

  // A tela consulta este estado ao sair do campo de usuário. O bloqueio é
  // sempre lido do Neon, nunca reconstruído a partir de estado local.
  if (input["action"] === "status") {
    if (!username) return Response.json({ ok: true, locked: false });
    const statusClient = await getNeonPool().connect();
    try {
      await statusClient.query("BEGIN");
      await statusClient.query("SET LOCAL ROLE mobflow_api");
      const security = await checkLoginSecurity(
        statusClient,
        request,
        username,
        expectedRole === "manager" ? cnpj : undefined,
      );
      await statusClient.query("COMMIT");
      if (security.blockedUntil) {
        return Response.json(
          { ok: false, locked: true, retryAfterSeconds: security.retryAfterSeconds, error: "Muitas tentativas incorretas. Acesso temporariamente bloqueado por 30 minutos." },
          { status: 429, headers: { "Retry-After": String(security.retryAfterSeconds) } },
        );
      }
      return Response.json({ ok: true, locked: false });
    } catch (error) {
      await statusClient.query("ROLLBACK").catch(() => undefined);
      console.error("[MobFlow auth security] Could not read login lockout", error instanceof Error ? error.message : "unknown error");
      return Response.json({ ok: false, error: "Não foi possível consultar o bloqueio de acesso." }, { status: 503 });
    } finally {
      statusClient.release();
    }
  }

  if (!username) {
    return Response.json({ ok: false, error: "Usuário ou senha inválido." }, { status: 400 });
  }

  const client = await getNeonPool().connect();
  let open = false;
  let loginLockKey: string | null = null;
  try {
    loginLockKey = await acquireLoginAttemptLock(client, username);
    await client.query("BEGIN");
    open = true;
    await client.query("SET LOCAL ROLE mobflow_api");

    if (password.length < 6) deny("Usuário ou senha inválido.", 400);

    const security = await checkLoginSecurity(client, request, username, cnpj.length === 14 ? cnpj : undefined);
    if (security.blockedUntil) {
      throw new LoginError("Muitas tentativas incorretas. Acesso temporariamente bloqueado por 30 minutos.", 429, security.retryAfterSeconds);
    }
    if (security.captchaRequired) {
      if (!captchaToken || !(await verifyCompanyLoginCaptcha(request, captchaToken))) {
        throw new LoginError("Confirme a verificação de segurança para continuar.", 428);
      }
    }

    const found = await client.query<{
      id: string; username: string; cnpj: string; account_id: string; role: string;
      active: boolean; display_name: string | null; permissions: unknown;
    }>(
      `SELECT id::text, username, cnpj, account_id::text, role, active, display_name, permissions
       FROM public.mobflow_find_login_profile($1)`,
      [username],
    );
    let profile = found.rows[0] ?? null;
    let firstManagerLogin = false;

    if (profile?.account_id) {
      await client.query(
        `SELECT
           set_config('app.account_id', $1, true),
           set_config('app.user_id', $2, true),
           set_config('app.role', $3, true)`,
        [profile.account_id, profile.id, profile.role],
      );
      const result = await client.query<{ subscription_status: string; subscription_expires_at: string | null }>(
        "SELECT subscription_status, subscription_expires_at FROM public.companies WHERE account_id = $1 LIMIT 1",
        [profile.account_id],
      );
      const company = result.rows[0];
      if (!company) return deny("Assinatura da empresa não encontrada. Entre em contato com o MobFlow.", 403);
      const expired = Boolean(company.subscription_expires_at && new Date(company.subscription_expires_at).getTime() <= Date.now());
      if (expired && company.subscription_status === "active") {
        await client.query("SELECT public.mobflow_mark_subscription_past_due($1::uuid)", [profile.account_id]);
      }
      if (company.subscription_status !== "active" || expired) {
        deny(expired
          ? "A mensalidade desta empresa venceu. Solicite ao administrador a confirmação do pagamento para liberar o acesso."
          : "A assinatura desta empresa não está ativa. Entre em contato com o administrador do MobFlow.", 403);
      }
    }

    if (profile) {
      const management = profile.role === "manager" ||
        (profile.role === "pdv" && Array.isArray(profile.permissions) && profile.permissions.includes("Gerência"));
      if (!profile.active) deny("Usuário ou acesso inválido.");
      if (expectedRole === "pdv" && profile.role !== "pdv") deny("Esse usuário não é um usuário do PDV. Use um usuário criado em Configurações → Usuários do PDV.", 403);
      if (expectedRole === "pdv" && cnpj.length !== 14) deny("Informe o CNPJ da empresa para validar o acesso do PDV.", 400);
      if (expectedRole === "pdv" && profile.cnpj !== cnpj) deny("Esse usuário do PDV pertence a outra empresa.", 403);
      if (expectedRole === "manager" && !management) deny("Esse usuário não tem permissão de Gerência.", 403);
      if (expectedRole === "manager" && profile.cnpj !== cnpj) deny("CNPJ da empresa inválido.");
      if (expectedRole === "manager" && profile.account_id) {
        const securityResult = await client.query<{ first_manager_login: boolean }>(
          "SELECT public.mobflow_is_first_manager_login($1::uuid) AS first_manager_login",
          [profile.account_id],
        );
        firstManagerLogin = securityResult.rows[0]?.first_manager_login === true;
      }
      const account = await client.query<{ password: string | null }>(
        "SELECT public.mobflow_get_login_credential($1::uuid) AS password",
        [profile.id],
      );
      if (!account.rows[0]?.password || !(await bcrypt.compare(password, account.rows[0].password))) {
        deny("Usuário ou senha inválido.");
      }
    } else {
      if (expectedRole !== "manager") deny("Usuário do PDV não encontrado. Cadastre-o primeiro pela gerência da empresa.");
      if (cnpj.length !== 14) deny("Para acessar a gerência, informe o CNPJ da empresa.", 400);
      const allowed = await client.query(
        "SELECT 1 FROM public.account_allowlist WHERE username=$1 AND cnpj=$2 AND active=true LIMIT 1",
        [username, cnpj],
      );
      if (!allowed.rows.length) deny("Usuário não autorizado.");
      const existing = await client.query("SELECT id FROM public.profiles WHERE cnpj=$1 LIMIT 1", [cnpj]);
      const id = randomUUID();
      const now = new Date();
      const hash = await bcrypt.hash(password, 12);
      await client.query(
        `INSERT INTO public."user" (id,name,email,"emailVerified","createdAt","updatedAt")
         VALUES ($1,$2,$3,true,$4,$4)`,
        [id, username, emailFor(username), now],
      );
      await client.query(
        `INSERT INTO public."account" (id,"accountId","providerId","userId",password,"createdAt","updatedAt")
         VALUES ($1,$1,'credential',$1,$2,$3,$3)`,
        [id, hash, now],
      );
      await client.query(
        `INSERT INTO public.profiles (id,username,cnpj,account_id,role,active,display_name,permissions)
         VALUES ($1,$2,$3,$1,'manager',true,$2,$4::jsonb)`,
        [id, username, cnpj, JSON.stringify(MANAGER_PERMISSIONS)],
      );
      profile = { id, username, cnpj, account_id: id, role: "manager", active: true, display_name: username, permissions: MANAGER_PERMISSIONS };
      firstManagerLogin = existing.rows.length === 0;
    }

    await recordLoginSuccess(client, request, username, cnpj.length === 14 ? cnpj : undefined);
    await client.query("SAVEPOINT login_audit_event");
    try {
      await recordLoginAuditEvent(client, request, {
        username, cnpj, role: expectedRole, eventType: "login_succeeded", success: true,
        httpStatus: 200, accountId: profile.account_id, location: input["location"],
      });
      await client.query("RELEASE SAVEPOINT login_audit_event");
    } catch (auditError) {
      await client.query("ROLLBACK TO SAVEPOINT login_audit_event");
      await client.query("RELEASE SAVEPOINT login_audit_event");
      console.error("[MobFlow login audit] Could not record successful login", auditError instanceof Error ? auditError.message : "unknown");
    }
    await client.query("COMMIT");
    open = false;
    return Response.json({
      ok: true,
      firstManagerLogin,
      profile: {
        username: profile.username,
        role: expectedRole === "manager" ? "manager" : profile.role,
        account_id: profile.account_id,
        display_name: profile.display_name ?? username,
        permissions: expectedRole === "manager" ? MANAGER_PERMISSIONS : (Array.isArray(profile.permissions) ? profile.permissions : PDV_PERMISSIONS),
      },
    });
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => undefined);
    open = false;
    if (error instanceof LoginError) {
      if (username) {
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL ROLE mobflow_api");
          const failure = error.status === 401
            ? await recordLoginFailure(client, request, username, cnpj.length === 14 ? cnpj : undefined)
            : null;
          const eventType = error.status === 428 ? "captcha_rejected"
            : error.status === 429 ? "login_blocked"
            : error.status === 401 ? "login_failed"
            : "login_denied";
          await client.query("SAVEPOINT login_audit_event");
          try {
            await recordLoginAuditEvent(client, request, {
              username, cnpj, role: expectedRole, eventType, success: false,
              httpStatus: error.status, location: input["location"],
            });
            await client.query("RELEASE SAVEPOINT login_audit_event");
          } catch (auditError) {
            await client.query("ROLLBACK TO SAVEPOINT login_audit_event");
            await client.query("RELEASE SAVEPOINT login_audit_event");
            console.error("[MobFlow login audit] Could not record failed login", auditError instanceof Error ? auditError.message : "unknown");
          }
          await client.query("COMMIT");
          if (failure?.blockedUntil && failure.blockedUntil.getTime() > Date.now()) {
            const retryAfter = Math.max(1, Math.ceil((failure.blockedUntil.getTime() - Date.now()) / 1000));
            return Response.json(
              { ok: false, locked: true, retryAfterSeconds: retryAfter, error: "Muitas tentativas incorretas. Acesso temporariamente bloqueado por 30 minutos." },
              { status: 429, headers: { "Retry-After": String(retryAfter) } },
            );
          }
        } catch (securityError) {
          await client.query("ROLLBACK").catch(() => undefined);
          console.error("[MobFlow auth security] Could not record login failure", securityError instanceof Error ? securityError.message : "unknown");
          return Response.json({ ok: false, error: "Não foi possível validar a segurança do acesso agora." }, { status: 503 });
        }
      }
      if (error.status === 428) {
        return Response.json({ ok: false, captchaRequired: true, error: error.message }, { status: 428 });
      }
      if (error.status === 429) {
        const retryAfter = error.retryAfterSeconds || 1800;
        return Response.json(
          { ok: false, locked: true, retryAfterSeconds: retryAfter, error: error.message },
          { status: 429, headers: { "Retry-After": String(retryAfter) } },
        );
      }
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[MobFlow Better Auth login]", error instanceof Error ? error.message : "unknown error");
    return Response.json({ ok: false, error: "Não foi possível entrar agora." }, { status: 500 });
  } finally {
    if (loginLockKey) {
      await releaseLoginAttemptLock(client, loginLockKey).catch((error) => {
        console.error("[MobFlow auth security] Could not release login lock", error instanceof Error ? error.message : "unknown error");
      });
    }
    client.release();
  }
}

export const Route = createFileRoute("/api/mobflow/login")({
  server: { handlers: { POST: ({ request }) => handleMobFlowLogin(request) } },
});
