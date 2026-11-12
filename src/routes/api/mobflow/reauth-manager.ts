import { createFileRoute } from "@tanstack/react-router";
import type { PoolClient } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction, getNeonPool } from "@/lib/server/neon";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

async function handleReauth(request: Request) {
  if (process.env["MOBFLOW_AUTH_PROVIDER"] !== "better-auth") {
    return Response.json({ ok: false, error: "Este fluxo ainda não está ativo neste ambiente." }, { status: 503 });
  }

  let authTransaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
  let client: PoolClient | null = null;
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
    const result = await client.query<{ password_hash: string | null }>(
      "SELECT public.mobflow_get_manager_password_hash($1) AS password_hash",
      [identity.accountId],
    );
    const stored = result.rows[0]?.password_hash ?? undefined;

    if (action === "status") {
      return Response.json({ configured: Boolean(stored), role: identity.role, canManage });
    }

    if (action === "set_password") {
      if (password.length < 8) {
        return Response.json({ ok: false, error: "A senha da gerência precisa ter pelo menos 8 caracteres." }, { status: 400 });
      }
      if (stored) {
        return Response.json({ ok: false, error: "A senha da gerência já foi configurada. Use a senha atual para entrar." }, { status: 409 });
      }
      const saved = await client.query<{ saved: boolean }>(
        "SELECT public.mobflow_set_manager_password_hash($1,$2) AS saved",
        [identity.accountId, sha256(password)],
      );
      if (!saved.rows[0]?.saved) {
        return Response.json({ ok: false, error: "A senha da gerência já foi configurada. Atualize a tela e tente entrar." }, { status: 409 });
      }
      return Response.json({ ok: true });
    }

    if (action !== "verify") return Response.json({ ok: false, error: "Ação inválida." }, { status: 400 });
    if (!password) return Response.json({ ok: false, error: "Senha inválida." }, { status: 401 });
    if (!stored) return Response.json({ ok: false, error: "Senha da gerência não configurada para esta empresa." }, { status: 403 });
    if (sha256(password) !== stored) return Response.json({ ok: false, error: "Senha da gerência incorreta." }, { status: 401 });
    return Response.json({ ok: true });
  } catch (error) {
    if (authTransaction) {
      await releaseTransaction(authTransaction.client, false).catch(() => undefined);
    }
    return jsonError(error);
  } finally {
    client?.release();
  }
}

export const Route = createFileRoute("/api/mobflow/reauth-manager")({
  server: { handlers: { POST: ({ request }) => handleReauth(request) } },
});
