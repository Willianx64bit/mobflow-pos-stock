import { createFileRoute } from "@tanstack/react-router";
import { getMobFlowBetterAuth } from "@/lib/server/better-auth";
import { getNeonPool } from "@/lib/server/neon";
import {
  checkLoginSecurity,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/server/auth-security";

async function handleAuth(request: Request): Promise<Response> {
  const isEmailSignIn = request.method === "POST" &&
    new URL(request.url).pathname.replace(/\/+$/, "").endsWith("/sign-in/email");

  if (!isEmailSignIn) {
    try {
      return await getMobFlowBetterAuth().handler(request);
    } catch (error) {
      console.error("[MobFlow Better Auth] Request unavailable", error instanceof Error ? error.message : "unknown error");
      return Response.json(
        { message: "A autenticação Neon ainda não está configurada neste ambiente." },
        { status: 503 },
      );
    }
  }

  let username = "";
  try {
    const body = await request.clone().json() as { email?: unknown };
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email.endsWith("@accounts.mobflow.local")) {
      return Response.json({ message: "Credenciais inválidas." }, { status: 401 });
    }
    username = email.slice(0, -"@accounts.mobflow.local".length);
    if (!username) return Response.json({ message: "Credenciais inválidas." }, { status: 401 });

    const client = await getNeonPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE mobflow_api");
      const security = await checkLoginSecurity(client, request, username);
      if (security.blockedUntil) {
        await client.query("ROLLBACK");
        return Response.json(
          { message: "Muitas tentativas incorretas. Acesso temporariamente bloqueado por 30 minutos.", code: "AUTH_LOCKED" },
          { status: 429, headers: { "Retry-After": String(security.retryAfterSeconds) } },
        );
      }
      // The custom company-login endpoint performs Turnstile verification.
      // Direct Better Auth sign-in is rejected while the same IP/device is suspicious.
      if (security.captchaRequired) {
        await client.query("ROLLBACK");
        return Response.json(
          { message: "É necessária uma nova verificação de segurança no login da empresa.", code: "CAPTCHA_REQUIRED" },
          { status: 428 },
        );
      }

      let response: Response;
      try {
        response = await getMobFlowBetterAuth().handler(request);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      if (response.ok) {
        await recordLoginSuccess(client, request, username);
      } else if (response.status === 401 || response.status === 403) {
        const failure = await recordLoginFailure(client, request, username);
        if (failure.blockedUntil && failure.blockedUntil.getTime() > Date.now()) {
          await client.query("COMMIT");
          const retryAfter = Math.max(1, Math.ceil((failure.blockedUntil.getTime() - Date.now()) / 1000));
          return Response.json(
            { message: "Muitas tentativas incorretas. Acesso temporariamente bloqueado por 30 minutos.", code: "AUTH_LOCKED" },
            { status: 429, headers: { "Retry-After": String(retryAfter) } },
          );
        }
      }
      await client.query("COMMIT");
      return response;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[MobFlow Better Auth] Sign-in security unavailable", error instanceof Error ? error.message : "unknown error");
    return Response.json(
      { message: "Não foi possível validar a segurança do acesso agora." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request),
    },
  },
});
