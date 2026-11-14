import { createFileRoute } from "@tanstack/react-router";
import type { PoolClient } from "@neondatabase/serverless";
import { createHash, timingSafeEqual } from "node:crypto";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction, getNeonPool } from "@/lib/server/neon";
import {
  checkManagerPasswordLockout,
  recordManagerPasswordFailure,
  recordManagerPasswordSuccess,
} from "@/lib/server/auth-security";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

async function handleReauth(request: Request) {
  if (process.env["MOBFLOW_AUTH_PROVIDER"] !== "better-auth") {
    return Response.json({ ok: false, error: "Este fluxo ainda não está ativo neste ambiente." }, { status: 503 });
  }

  let authTransaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
  let client: PoolClient | null = null;
  let transactionOpen = false;
  try {
    authTransaction = await beginAuthenticatedTransaction(request);
    const identity = authTransaction.identity;
    await releaseTransaction(authTransaction.client, true);
    authTransaction = null;

    const canManage = identity.role === "manager" ||
      (Array.isArray(identity.permissions) && identity.permissions.includes("Gerência"));
    if (!canManage || !identity.accountId) {
      return Response.json({ ok: false, error: "Acesso de gerência necessário." }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { body = {}; }
    const action = String(body["action"] ?? "verify");
    const password = String(body["password"] ?? "");

    client = await getNeonPool().connect();
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SET LOCAL ROLE mobflow_api");

    const result = await client.query<{ password_hash: string | null }>(
      "SELECT public.mobflow_get_manager_password_hash($1) AS password_hash",
      [identity.accountId],
    );
    const stored = result.rows[0]?.password_hash ?? undefined;

    if (action === "status") {
      await client.query("COMMIT");
      transactionOpen = false;
      return Response.json({ configured: Boolean(stored), role: identity.role, canManage });
    }

    if (action === "set_password") {
      if (password.length < 8) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return Response.json({ ok: false, error: "A senha da gerência precisa ter pelo menos 8 caracteres." }, { status: 400 });
      }
      if (stored) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return Response.json({ ok: false, error: "A senha da gerência já foi configurada. Use a senha atual para entrar." }, { status: 409 });
      }
      const saved = await client.query<{ saved: boolean }>(
        "SELECT public.mobflow_set_manager_password_hash($1,$2) AS saved",
        [identity.accountId, sha256(password)],
      );
      if (!saved.rows[0]?.saved) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return Response.json({ ok: false, error: "A senha da gerência já foi configurada. Atualize a tela e tente entrar." }, { status: 409 });
      }
      await client.query("COMMIT");
      transactionOpen = false;
      return Response.json({ ok: true });
    }

    if (action !== "verify") {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return Response.json({ ok: false, error: "Ação inválida." }, { status: 400 });
    }

    const lockout = await checkManagerPasswordLockout(client, identity.accountId);
    if (lockout.blockedUntil) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return Response.json(
        { ok: false, locked: true, retryAfterSeconds: lockout.retryAfterSeconds, error: "Muitas tentativas incorretas. A senha da Gerência foi bloqueada por 30 minutos." },
        { status: 429, headers: { "Retry-After": String(lockout.retryAfterSeconds) } },
      );
    }

    if (!stored) {
      await client.query("COMMIT");
      transactionOpen = false;
      return Response.json({ ok: false, error: "Senha da gerência não configurada para esta empresa." }, { status: 403 });
    }

    const candidate = Buffer.from(sha256(password), "hex");
    const expected = Buffer.from(stored, "hex");
    const matches = candidate.length === expected.length && timingSafeEqual(candidate, expected);
    if (!matches) {
      const failure = await recordManagerPasswordFailure(client, identity.accountId);
      await client.query("COMMIT");
      transactionOpen = false;
      if (failure.blockedUntil && failure.blockedUntil.getTime() > Date.now()) {
        const retryAfter = Math.max(1, Math.ceil((failure.blockedUntil.getTime() - Date.now()) / 1000));
        return Response.json(
          { ok: false, locked: true, retryAfterSeconds: retryAfter, error: "Muitas tentativas incorretas. A senha da Gerência foi bloqueada por 30 minutos." },
          { status: 429, headers: { "Retry-After": String(retryAfter) } },
        );
      }
      return Response.json({ ok: false, error: "Senha da gerência incorreta." }, { status: 401 });
    }

    await recordManagerPasswordSuccess(client, identity.accountId);
    await client.query("COMMIT");
    transactionOpen = false;
    return Response.json({ ok: true });
  } catch (error) {
    if (authTransaction) {
      await releaseTransaction(authTransaction.client, false).catch(() => undefined);
    }
    if (transactionOpen && client) await client.query("ROLLBACK").catch(() => undefined);
    return jsonError(error);
  } finally {
    client?.release();
  }
}

export const Route = createFileRoute("/api/mobflow/reauth-manager")({
  server: { handlers: { POST: ({ request }) => handleReauth(request) } },
});
