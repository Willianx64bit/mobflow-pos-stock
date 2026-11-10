import { createPublicKey, verify as verifySignature } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { getNeonPool } from "@/lib/server/neon";
import { getMobFlowBetterAuth } from "@/lib/server/better-auth";

const NEON_AUTH_PROVIDER = "neon";
const JWKS_CACHE_MS = 5 * 60 * 1000;

type NeonJwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
type NeonJwks = { keys?: NeonJwk[] };
type NeonJwtPayload = { sub?: unknown; iss?: unknown; exp?: unknown; nbf?: unknown };

let cachedJwks: { keys: NeonJwk[]; expiresAt: number } | null = null;

export type MobFlowIdentity = {
  userId: string;
  accountId: string;
  role: "manager" | "pdv" | "admin";
  username: string;
  displayName: string | null;
  permissions: unknown;
};

export type AuthenticatedTransaction = {
  client: PoolClient;
  identity: MobFlowIdentity;
};

export class ApiAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}

function decodeJwtPart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
}

async function getNeonJwks(): Promise<NeonJwk[]> {
  const now = Date.now();
  if (cachedJwks && cachedJwks.expiresAt > now) return cachedJwks.keys;

  const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
  if (!jwksUrl) {
    throw new ApiAuthError("A autenticação Neon ainda não foi configurada neste ambiente.", 503, "auth_not_configured");
  }

  let response: Response;
  try {
    response = await fetch(jwksUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiAuthError("Não foi possível consultar a chave de autenticação Neon.", 503, "auth_unavailable");
  }

  if (!response.ok) {
    throw new ApiAuthError("O serviço de autenticação Neon está indisponível.", 503, "auth_unavailable");
  }

  const body = (await response.json().catch(() => null)) as NeonJwks | null;
  if (!body || !Array.isArray(body.keys) || body.keys.length === 0) {
    throw new ApiAuthError("A configuração de chaves da autenticação Neon é inválida.", 503, "invalid_auth_config");
  }

  cachedJwks = { keys: body.keys, expiresAt: now + JWKS_CACHE_MS };
  return body.keys;
}

async function verifyNeonAccessToken(token: string): Promise<string> {
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  if (!baseUrl) {
    throw new ApiAuthError("A URL da autenticação Neon não foi configurada neste ambiente.", 503, "auth_not_configured");
  }

  let expectedIssuer: string;
  try {
    expectedIssuer = new URL(baseUrl).origin;
  } catch {
    throw new ApiAuthError("A URL da autenticação Neon está inválida.", 503, "invalid_auth_config");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new ApiAuthError("Sessão inválida ou expirada. Entre novamente.", 401, "invalid_token");
  }

  let header: { alg?: unknown; kid?: unknown };
  let payload: NeonJwtPayload;
  let signature: Buffer;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
    signature = Buffer.from(parts[2], "base64url");
  } catch {
    throw new ApiAuthError("Sessão inválida ou expirada. Entre novamente.", 401, "invalid_token");
  }

  if (header.alg !== "EdDSA" || typeof payload.sub !== "string" || !payload.sub) {
    throw new ApiAuthError("Sessão inválida ou expirada. Entre novamente.", 401, "invalid_token");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    payload.iss !== expectedIssuer ||
    typeof payload.exp !== "number" ||
    payload.exp <= nowSeconds ||
    (typeof payload.nbf === "number" && payload.nbf > nowSeconds)
  ) {
    throw new ApiAuthError("Sessão inválida ou expirada. Entre novamente.", 401, "invalid_token");
  }

  const keys = await getNeonJwks();
  const candidates = keys.filter((key) =>
    (typeof header.kid !== "string" || key.kid === header.kid) &&
    key.kty === "OKP" &&
    key.crv === "Ed25519" &&
    (!key.alg || key.alg === "EdDSA") &&
    (!key.use || key.use === "sig"),
  );

  if (candidates.length !== 1) {
    throw new ApiAuthError("A chave da sessão não foi reconhecida.", 401, "invalid_token");
  }

  try {
    const publicKey = createPublicKey({ key: candidates[0], format: "jwk" });
    const valid = verifySignature(
      null,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      publicKey,
      signature,
    );
    if (!valid) {
      throw new Error("Invalid JWT signature");
    }
  } catch {
    throw new ApiAuthError("Sessão inválida ou expirada. Entre novamente.", 401, "invalid_token");
  }

  return payload.sub;
}

async function resolveAuthProfileId(client: PoolClient, authUserId: string): Promise<string> {
  if (process.env.MOBFLOW_AUTH_PROVIDER === NEON_AUTH_PROVIDER) {
    const result = await client.query<{ profile_id: string }>(
      `SELECT profile_id
       FROM public.auth_identity_links
       WHERE provider = $1 AND auth_user_id = $2
       LIMIT 1`,
      [NEON_AUTH_PROVIDER, authUserId],
    );
    const profileId = result.rows[0]?.profile_id;
    if (!profileId || !/^[0-9a-f-]{36}$/i.test(profileId)) {
      throw new ApiAuthError(
        "A identidade Neon ainda não está vinculada ao perfil MobFlow. O vínculo precisa ser criado pelo processo administrativo de migração.",
        403,
        "identity_not_linked",
      );
    }
    return profileId;
  }

  if (!/^[0-9a-f-]{36}$/i.test(authUserId)) {
    throw new ApiAuthError("A identidade da sessão não é válida para este perfil.", 401, "invalid_token");
  }
  return authUserId;
}

export async function beginAuthenticatedTransaction(request: Request): Promise<AuthenticatedTransaction> {
  if (process.env.MOBFLOW_AUTH_PROVIDER !== "better-auth") {
    throw new ApiAuthError(
      "Este Preview exige Better Auth com Neon; autenticação alternativa está desativada.",
      503,
      "better_auth_required",
    );
  }

  let authSession: Awaited<ReturnType<ReturnType<typeof getMobFlowBetterAuth>["api"]["getSession"]>>;
  try {
    authSession = await getMobFlowBetterAuth().api.getSession({ headers: request.headers });
  } catch {
    throw new ApiAuthError("Não foi possível validar a sessão agora.", 503, "auth_unavailable");
  }

  if (!authSession?.user || typeof authSession.user.id !== "string" || !authSession.user.id) {
    throw new ApiAuthError("Sessão ausente ou expirada. Entre novamente no MobFlow.", 401, "invalid_token");
  }
  const authUserId = authSession.user.id;
  if (!/^[0-9a-f-]{36}$/i.test(authUserId)) {
    throw new ApiAuthError("A identidade da sessão não é válida para este perfil.", 401, "invalid_token");
  }

  const client = await getNeonPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE mobflow_api");
        const profileId = await resolveAuthProfileId(client, authUserId);
    await client.query("SELECT set_config('app.user_id', $1, true)", [profileId]);

    const profileResult = await client.query<{
      id: string;
      username: string;
      account_id: string;
      role: string;
      active: boolean;
      display_name: string | null;
      permissions: unknown;
    }>(
      `SELECT id, username, account_id, role, active, display_name, permissions
       FROM public.profiles
       WHERE id = $1
       LIMIT 1`,
      [profileId],
    );

    const profile = profileResult.rows[0];
    if (!profile) {
      throw new ApiAuthError("Este usuário ainda não foi preparado no banco MobFlow. O cadastro original foi preservado; a migração do perfil está pendente.", 403, "profile_not_migrated");
    }
    if (!profile.active) {
      throw new ApiAuthError("Este usuário está desativado.", 403, "profile_inactive");
    }
    if (!["manager", "pdv", "admin"].includes(profile.role)) {
      throw new ApiAuthError("Perfil sem permissão para acessar o MobFlow.", 403, "invalid_role");
    }

    await client.query("SELECT set_config('app.account_id', $1, true)", [profile.account_id]);
    await client.query("SELECT set_config('app.role', $1, true)", [profile.role]);

    // Re-check the tenant subscription on every authenticated request, not only
    // at login. This immediately blocks existing sessions after suspension/expiry.
    if (profile.role !== "admin") {
      const subscriptionResult = await client.query<{
        subscription_status: string;
        subscription_expires_at: Date | string | null;
      }>(
        "SELECT subscription_status, subscription_expires_at FROM public.companies WHERE account_id = $1 LIMIT 1",
        [profile.account_id],
      );
      const subscription = subscriptionResult.rows[0];
      if (!subscription) {
        throw new ApiAuthError("Assinatura da empresa não encontrada. Entre em contato com o administrador do MobFlow.", 403, "company_not_found");
      }
      const expiryValue = subscription.subscription_expires_at;
      const expiryTimestamp = expiryValue instanceof Date
        ? expiryValue.getTime()
        : expiryValue
          ? Date.parse(expiryValue)
          : null;
      const expired = expiryTimestamp !== null && expiryTimestamp <= Date.now();
      if (subscription.subscription_status !== "active" || expired) {
        throw new ApiAuthError(
          expired
            ? "A mensalidade desta empresa venceu. Solicite ao administrador a confirmação do pagamento para liberar o acesso."
            : "A assinatura desta empresa não está ativa. Entre em contato com o administrador do MobFlow.",
          403,
          expired ? "subscription_expired" : "subscription_inactive",
        );
      }
    }

    return {
      client,
      identity: {
        userId: profile.id,
        accountId: profile.account_id,
        role: profile.role as MobFlowIdentity["role"],
        username: profile.username,
        displayName: profile.display_name,
        permissions: profile.permissions,
      },
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    throw error;
  }
}

export function jsonError(error: unknown): Response {
  if (error instanceof ApiAuthError) {
    return Response.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error("[MobFlow API]", error);
  return Response.json(
    { ok: false, error: "Não foi possível concluir a operação agora.", code: "internal_error" },
    { status: 500 },
  );
}
