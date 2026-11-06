import type { PoolClient } from "@neondatabase/serverless";
import { getNeonPool } from "@/lib/server/neon";

const SUPABASE_URL = "https://ezkwubdpblqkdfampopa.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_UYLcJXGRBbP9aq4sPAD3Eg_jcKTuk6A";

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

export async function beginAuthenticatedTransaction(request: Request): Promise<AuthenticatedTransaction> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new ApiAuthError("Sessão ausente. Entre novamente no MobFlow.", 401, "missing_token");
  }

  const token = match[1].trim();
  if (!token || token.length > 8192) {
    throw new ApiAuthError("Sessão inválida. Entre novamente no MobFlow.", 401, "invalid_token");
  }

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
  if (!authUser || typeof authUser.id !== "string" || !/^[0-9a-f-]{36}$/i.test(authUser.id)) {
    throw new ApiAuthError("Não foi possível confirmar a identidade da sessão.", 401, "invalid_token");
  }

  const client = await getNeonPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [authUser.id]);

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
      [authUser.id],
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
