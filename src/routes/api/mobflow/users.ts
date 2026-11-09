import { createFileRoute } from "@tanstack/react-router";
import bcrypt from "bcryptjs";
import { createHash, randomUUID } from "node:crypto";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { getNeonPool, releaseTransaction } from "@/lib/server/neon";

const ALLOWED_PERMISSIONS = ["PDV", "Operações", "Conferência", "Validade", "Fiado", "Gerência"];
const DEFAULT_PERMISSIONS = ["PDV", "Operações"];
const EMPTY_STATE = {
  products: [], cart: [], sales: [], conferences: [], receiving: [],
  manualExpiries: [], promotions: [], suppliers: [], settings: { companyName: "" },
};

class UsersError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const deny = (message: string, status = 400): never => { throw new UsersError(message, status); };
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function getR2() {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) throw new Error("R2 não configurado para limpar os arquivos da empresa.");
  return new S3Client({ region: "auto", endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
}
function getR2Bucket() {
  const value = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  if (!value) throw new Error("Bucket R2 não configurado.");
  return value;
}
async function deleteOperationalR2Objects(tenantId: string) {
  const s3 = getR2();
  const bucket = getR2Bucket();
  const prefix = `tenants/${tenantId}/`;
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
    const keys = (page.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => !!key && (key.startsWith(`${prefix}products/`) || key.startsWith(`${prefix}company-logos/`)));
    if (keys.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true }));
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

const emailFor = (username: string) => username.toLowerCase().replace(/[^a-z0-9._-]/g, "-") + "@accounts.mobflow.local";

function normalizePermissions(value: unknown) {
  if (!Array.isArray(value)) return [...DEFAULT_PERMISSIONS];
  return [...new Set(value
    .filter((permission) => ALLOWED_PERMISSIONS.includes(String(permission)))
    .map((permission) => permission === "Conferência" ? "Operações" : String(permission)))];
}

async function handleUsers(request: Request) {
  if (process.env.MOBFLOW_AUTH_PROVIDER !== "better-auth") {
    return Response.json({ ok: false, error: "Este fluxo ainda não está ativo neste ambiente." }, { status: 503 });
  }

  let authTransaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
  let client: Awaited<ReturnType<ReturnType<typeof getNeonPool>["connect"]>> | null = null;
  let transactionOpen = false;

  try {
    authTransaction = await beginAuthenticatedTransaction(request);
    const identity = authTransaction.identity;
    await releaseTransaction(authTransaction.client, true);
    authTransaction = null;

    const canManageUsers = identity.role === "manager" ||
      (Array.isArray(identity.permissions) && identity.permissions.includes("Gerência"));
    if (!canManageUsers) deny("A conta precisa ter permissão de Gerência para acessar usuários do PDV.", 403);

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { body = {}; }
    const action = String(body.action ?? "list");

    client = await getNeonPool().connect();
    await client.query("BEGIN");
    transactionOpen = true;

    const managerResult = await client.query<{ cnpj: string }>(
      "SELECT cnpj FROM public.profiles WHERE id=$1 LIMIT 1",
      [identity.userId],
    );
    const managerCnpj = managerResult.rows[0]?.cnpj;
    if (!managerCnpj) deny("Não foi possível validar a empresa desta conta.", 403);

    if (action === "reset_application") {
      const managerPassword = String(body.managerPassword ?? "");
      if (!managerPassword) deny("Informe a senha da gerência.");
      if (identity.role !== "manager") deny("Somente o login principal da Gerência pode zerar a aplicação.", 403);

      const security = await client.query<{ password_hash: string }>(
        "SELECT password_hash FROM public.manager_security_by_account WHERE account_id=$1 LIMIT 1",
        [identity.accountId],
      );
      if (!security.rows[0]?.password_hash) deny("Não foi possível validar a senha da gerência.", 500);
      if (sha256(managerPassword) !== security.rows[0].password_hash) deny("Senha da gerência incorreta.", 401);

      // Limpa primeiro os registros operacionais dependentes, sem tocar no perfil/auth da Gerência.
      await client.query("DELETE FROM public.receivable_payments WHERE tenant_id=$1", [identity.accountId]);
      await client.query("DELETE FROM public.sale_items WHERE tenant_id=$1", [identity.accountId]);
      await client.query("DELETE FROM public.sale_payments WHERE tenant_id=$1", [identity.accountId]);
      await client.query("DELETE FROM public.cash_movements WHERE tenant_id=$1", [identity.accountId]);
      await client.query("DELETE FROM public.sales WHERE tenant_id=$1", [identity.accountId]);
      await client.query("DELETE FROM public.cash_sessions WHERE tenant_id=$1", [identity.accountId]);
      await client.query("DELETE FROM public.stock_movements WHERE tenant_id=$1", [identity.accountId]);
      await client.query("DELETE FROM public.promotions WHERE tenant_id=$1", [identity.accountId]);
      await client.query("DELETE FROM public.products WHERE tenant_id=$1", [identity.accountId]);
      await client.query("DELETE FROM public.mobflow_sync_events WHERE tenant_id=$1", [identity.accountId]);
      await client.query("DELETE FROM public.mobflow_sync_counters WHERE tenant_id=$1", [identity.accountId]);
      await client.query("DELETE FROM public.mobflow_legacy_backfill_runs WHERE tenant_id=$1", [identity.accountId]);

      await client.query(
        `INSERT INTO public.app_state (owner_id,state,updated_at)
         VALUES ($1,$2::jsonb,now())
         ON CONFLICT (owner_id) DO UPDATE SET state=EXCLUDED.state, updated_at=now()`,
        [identity.accountId, JSON.stringify(EMPTY_STATE)],
      );

      const users = await client.query<{ id: string; username: string }>(
        "SELECT id::text,username FROM public.profiles WHERE account_id=$1 AND role='pdv'",
        [identity.accountId],
      );
      const ids = users.rows.map((user) => user.id);
      const usernames = users.rows.map((user) => user.username);
      if (usernames.length) {
        await client.query(
          "DELETE FROM public.account_allowlist WHERE username=ANY($1::text[]) AND cnpj=$2",
          [usernames, managerCnpj],
        );
        await client.query("DELETE FROM public.profiles WHERE id=ANY($1::uuid[])", [ids]);
        await client.query('DELETE FROM public."user" WHERE id=ANY($1::text[])', [ids]);
      }

      const verify = await client.query<{ state: Record<string, unknown>; updated_at: string }>(
        "SELECT state,updated_at FROM public.app_state WHERE owner_id=$1 LIMIT 1",
        [identity.accountId],
      );
      const state = verify.rows[0]?.state;
      const arraysEmpty = !!state && ["products","cart","sales","conferences","receiving","manualExpiries","promotions","suppliers"]
        .every((key) => Array.isArray(state[key]) && (state[key] as unknown[]).length === 0);
      const settings = state?.settings && typeof state.settings === "object" ? state.settings as Record<string, unknown> : {};
      if (!arraysEmpty || settings.pixKey || settings.companyLogo) {
        deny("A limpeza foi solicitada, mas a verificação final no Neon não confirmou todos os dados vazios.", 500);
      }

      await client.query("COMMIT");
      transactionOpen = false;
      try {
        await deleteOperationalR2Objects(identity.accountId);
      } catch (cleanupError) {
        console.error("[MobFlow reset R2 cleanup]", cleanupError instanceof Error ? cleanupError.message : "unknown");
        return Response.json({ ok: false, deleted: ids.length, cloudCleared: false, error: "Os dados operacionais do Neon foram limpos, mas não foi possível confirmar a remoção de todas as fotos/logo no R2. Repita a operação para concluir a limpeza dos arquivos." }, { status: 503 });
      }
      return Response.json({ ok: true, deleted: ids.length, cloudCleared: true, updatedAt: verify.rows[0].updated_at });
    }

    if (action === "delete_all_pdv") {
      const users = await client.query<{ id: string; username: string }>(
        "SELECT id::text,username FROM public.profiles WHERE account_id=$1 AND role='pdv'",
        [identity.accountId],
      );
      const ids = users.rows.map((user) => user.id);
      const usernames = users.rows.map((user) => user.username);
      if (usernames.length) {
        await client.query(
          "UPDATE public.account_allowlist SET active=false WHERE username=ANY($1::text[]) AND cnpj=$2",
          [usernames, managerCnpj],
        );
        await client.query("DELETE FROM public.profiles WHERE id=ANY($1::uuid[])", [ids]);
        await client.query('DELETE FROM public."user" WHERE id=ANY($1::text[])', [ids]);
      }
      await client.query("COMMIT");
      transactionOpen = false;
      return Response.json({ ok: true, deleted: ids.length });
    }

    if (action === "list") {
      const result = await client.query(
        `SELECT id::text,username,display_name,role,active,created_at,permissions
         FROM public.profiles
         WHERE account_id=$1 AND role='pdv'
         ORDER BY created_at DESC`,
        [identity.accountId],
      );
      await client.query("COMMIT");
      transactionOpen = false;
      return Response.json({
        users: result.rows.map((user) => ({
          ...user,
          permissions: Array.isArray(user.permissions) ? user.permissions : ["PDV", "Conferência"],
        })),
      });
    }

    if (action === "create") {
      const username = String(body.username ?? "").trim().toUpperCase();
      const displayName = String(body.displayName ?? "").trim() || username;
      const permissions = normalizePermissions(body.permissions);
      const password = String(body.password ?? "");

      const existingPdv = await client.query(
        "SELECT id FROM public.profiles WHERE account_id=$1 AND role='pdv' LIMIT 1",
        [identity.accountId],
      );
      if (!existingPdv.rows.length && !permissions.includes("Gerência")) permissions.push("Gerência");
      if (!/^[A-Z0-9._-]{3,40}$/.test(username)) deny("Usuário inválido. Use letras, números, ponto, hífen ou underline.");
      if (password.length < 6) deny("A senha precisa ter pelo menos 6 caracteres.");

      const existingProfile = await client.query("SELECT id FROM public.profiles WHERE username=$1 LIMIT 1", [username]);
      if (existingProfile.rows.length) deny("Esse usuário já existe.", 409);

      const allowlist = await client.query<{ cnpj: string; active: boolean }>(
        "SELECT cnpj,active FROM public.account_allowlist WHERE username=$1 LIMIT 1",
        [username],
      );
      if (allowlist.rows[0] && allowlist.rows[0].cnpj !== managerCnpj) {
        deny("Esse usuário já está vinculado a outra empresa.", 409);
      }
      if (!allowlist.rows[0]) {
        await client.query(
          "INSERT INTO public.account_allowlist (username,cnpj,active) VALUES ($1,$2,true)",
          [username, managerCnpj],
        );
      } else if (!allowlist.rows[0].active) {
        await client.query(
          "UPDATE public.account_allowlist SET cnpj=$2,active=true WHERE username=$1",
          [username, managerCnpj],
        );
      }

      const id = randomUUID();
      const now = new Date();
      const hash = await bcrypt.hash(password, 12);
      await client.query(
        `INSERT INTO public."user" (id,name,email,"emailVerified","createdAt","updatedAt")
         VALUES ($1,$2,$3,true,$4,$4)`,
        [id, displayName, emailFor(username), now],
      );
      await client.query(
        `INSERT INTO public."account" (id,"accountId","providerId","userId",password,"createdAt","updatedAt")
         VALUES ($1,$1,'credential',$1,$2,$3,$3)`,
        [id, hash, now],
      );
      await client.query(
        `INSERT INTO public.profiles (id,username,cnpj,account_id,role,active,display_name,permissions)
         VALUES ($1,$2,$3,$4,'pdv',true,$5,$6::jsonb)`,
        [id, username, managerCnpj, identity.accountId, displayName, JSON.stringify(permissions)],
      );

      await client.query("COMMIT");
      transactionOpen = false;
      return Response.json({ ok: true });
    }

    const userId = String(body.userId ?? "");
    if (!userId) deny("Usuário não informado.");
    const targetResult = await client.query<{ id: string; username: string; cnpj: string }>(
      "SELECT id::text,username,cnpj FROM public.profiles WHERE id=$1 AND account_id=$2 AND role='pdv' LIMIT 1",
      [userId, identity.accountId],
    );
    const target = targetResult.rows[0];
    if (!target) deny("Usuário não encontrado.", 404);

    if (action === "update_permissions") {
      const permissions = Array.isArray(body.permissions) ? normalizePermissions(body.permissions) : null;
      if (!permissions) deny("Informe as permissões de acesso do usuário.");
      if (target.id === identity.userId &&
        Array.isArray(identity.permissions) &&
        identity.permissions.includes("Gerência") &&
        !permissions.includes("Gerência")) {
        deny("Você não pode desativar a permissão Gerência do usuário que está usando agora, pois pode perder o acesso total à empresa. As outras permissões podem ser alteradas normalmente.", 403);
      }
      await client.query("UPDATE public.profiles SET permissions=$2::jsonb WHERE id=$1", [userId, JSON.stringify(permissions)]);
      await client.query("COMMIT");
      transactionOpen = false;
      return Response.json({ ok: true });
    }

    if (action === "toggle") {
      await client.query("UPDATE public.profiles SET active=$2 WHERE id=$1", [userId, Boolean(body.active)]);
      await client.query("COMMIT");
      transactionOpen = false;
      return Response.json({ ok: true });
    }

    if (action === "reset_password") {
      const password = String(body.password ?? "");
      if (password.length < 6) deny("A senha precisa ter pelo menos 6 caracteres.");
      const hash = await bcrypt.hash(password, 12);
      const update = await client.query(
        `UPDATE public."account" SET password=$2,"updatedAt"=now()
         WHERE "userId"=$1 AND "providerId"='credential' AND "accountId"=$1`,
        [userId, hash],
      );
      if (!update.rowCount) deny("Não foi possível localizar a credencial deste usuário.", 404);
      await client.query('DELETE FROM public."session" WHERE "userId"=$1', [userId]);
      await client.query("COMMIT");
      transactionOpen = false;
      return Response.json({ ok: true });
    }

    if (action === "delete") {
      await client.query(
        "UPDATE public.account_allowlist SET active=false WHERE username=$1 AND cnpj=$2",
        [target.username, managerCnpj],
      );
      await client.query("DELETE FROM public.profiles WHERE id=$1", [userId]);
      await client.query('DELETE FROM public."user" WHERE id=$1', [userId]);
      await client.query("COMMIT");
      transactionOpen = false;
      return Response.json({ ok: true });
    }

    deny("Ação inválida.", 400);
  } catch (error) {
    if (transactionOpen && client) await client.query("ROLLBACK").catch(() => undefined);
    if (authTransaction) await releaseTransaction(authTransaction.client, false).catch(() => undefined);
    if (error instanceof UsersError) return Response.json({ ok: false, error: error.message }, { status: error.status });
    if ((error as { code?: string })?.code === "23505") {
      return Response.json({ ok: false, error: "Esse usuário já existe." }, { status: 409 });
    }
    return jsonError(error);
  } finally {
    client?.release();
  }
}

export const Route = createFileRoute("/api/mobflow/users")({
  server: { handlers: { POST: ({ request }) => handleUsers(request) } },
});
