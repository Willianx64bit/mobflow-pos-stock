import { createPublicKey, verify as verifySignature } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { getNeonPool } from "@/lib/server/neon";
import { getMobFlowBetterAuth } from "@/lib/server/better-auth";

const SUPABASE_URL = "https://ezkwubdpblqkdfampopa.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_UYLcJXGRBbP9aq4sPAD3Eg_jcKTuk6A";
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
  let authUserId: string;

  if (process.env.MOBFLOW_AUTH_PROVIDER === "better-auth") {
    let authSession: Awaited<ReturnType<ReturnType<typeof getMobFlowBetterAuth>["api"]["getSession"]>>;
    try {
      authSession = await getMobFlowBetterAuth().api.getSession({ headers: request.headers });
    } catch {
      throw new ApiAuthError("Não foi possível validar a sessão agora.", 503, "auth_unavailable");
    }

    if (!authSession?.user || typeof authSession.user.id !== "string" || !authSession.user.id) {
      throw new ApiAuthError("Sessão ausente ou expirada. Entre novamente no MobFlow.", 401, "invalid_token");
    }
    authUserId = authSession.user.id;
  } else {
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      throw new ApiAuthError("Sessão ausente. Entre novamente no MobFlow.", 401, "missing_token");
    }

    const token = match[1].trim();
    if (!token || token.length > 8192) {
      throw new ApiAuthError("Sessão inválida. Entre novamente no MobFlow.", 401, "invalid_token");
    }

    if (process.env.MOBFLOW_AUTH_PROVIDER === NEON_AUTH_PROVIDER) {
      authUserId = await verifyNeonAccessToken(token);
    } else {
      let authResponse: Response;
      try {
        authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          method: "GET",
          headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            authorization: `Bearer ${token}`,
            accept: "application/json",
          },
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new ApiAuthError("Não foi possível validar a sessão agora.", 503, "auth_unavailable");
      }

      if (!authResponse.ok) {
        if (authResponse.status === 401 || authResponse.status === 403) {
          throw new ApiAuthError("Sessão inválida ou expirada. Entre novamente.", 401, "invalid_token");
        }
        throw new ApiAuthError("O serviço de autenticação está indisponível.", 503, "auth_unavailable");
      }

      const authUser = (await authResponse.json().catch(() => null)) as { id?: unknown } | null;
      if (!authUser || typeof authUser.id !== "string") {
        throw new ApiAuthError("Não foi possível confirmar a identidade da sessão.", 401, "invalid_token");
      }
      authUserId = authUser.id;
    }
  }

  // Reject malformed Supabase subjects before opening a database connection.
  // Managed Neon Auth uses opaque subject IDs and resolves them through the
  // explicit auth_identity_links table below.
  if (
    process.env.MOBFLOW_AUTH_PROVIDER !== NEON_AUTH_PROVIDER &&
    !/^[0-9a-f-]{36}$/i.test(authUserId)
  ) {
    throw new ApiAuthError("A identidade da sessão não é válida para este perfil.", 401, "invalid_token");
  }

  const client = await getNeonPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE mobflow_api");
    if (process.env.MOBFLOW_AUTH_PROVIDER === NEON_AUTH_PROVIDER) {
      await client.query("SELECT set_config('app.auth_user_id', $1, true)", [authUserId]);
    }
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
