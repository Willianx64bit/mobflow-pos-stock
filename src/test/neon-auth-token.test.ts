import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign as signJwt } from "node:crypto";

const { client, connect } = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const client = { query, release };
  return { client, connect: vi.fn(async () => client) };
});

vi.mock("@/lib/server/neon", () => ({
  getNeonPool: () => ({ connect }),
}));

import { beginAuthenticatedTransaction } from "@/lib/server/mobflow-auth";

const PROFILE_ID = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const ACCOUNT_ID = PROFILE_ID;
const AUTH_USER_ID = "neon-managed-user-id-not-a-uuid";

const TEST_KEY_PAIR = generateKeyPairSync("ed25519");
const TEST_JWK = TEST_KEY_PAIR.publicKey.export({ format: "jwk" });

function makeToken() {
  const { privateKey } = TEST_KEY_PAIR;
  const jwk = TEST_JWK;
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid: "mobflow-test-key", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: AUTH_USER_ID,
    iss: "https://mobflow-test.neonauth.example",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  })).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = signJwt(null, Buffer.from(signingInput), privateKey).toString("base64url");
  return {
    token: `${signingInput}.${signature}`,
    jwk: { ...jwk, kid: "mobflow-test-key", alg: "EdDSA", use: "sig" },
  };
}

function request(token: string) {
  return new Request("https://mobflow.test/api/mobflow/session-context", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("MobFlow Neon Managed Auth API bridge", () => {
  const originalEnv = {
    provider: process.env.MOBFLOW_AUTH_PROVIDER,
    baseUrl: process.env.NEON_AUTH_BASE_URL,
    jwksUrl: process.env.NEON_AUTH_JWKS_URL,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client.query.mockReset();
    client.release.mockReset();
    connect.mockReset().mockResolvedValue(client);
    process.env.MOBFLOW_AUTH_PROVIDER = "neon";
    process.env.NEON_AUTH_BASE_URL = "https://mobflow-test.neonauth.example/auth";
    process.env.NEON_AUTH_JWKS_URL = "https://mobflow-test.neonauth.example/auth/jwks";
  });

  afterEach(() => {
    if (originalEnv.provider === undefined) delete process.env.MOBFLOW_AUTH_PROVIDER;
    else process.env.MOBFLOW_AUTH_PROVIDER = originalEnv.provider;
    if (originalEnv.baseUrl === undefined) delete process.env.NEON_AUTH_BASE_URL;
    else process.env.NEON_AUTH_BASE_URL = originalEnv.baseUrl;
    if (originalEnv.jwksUrl === undefined) delete process.env.NEON_AUTH_JWKS_URL;
    else process.env.NEON_AUTH_JWKS_URL = originalEnv.jwksUrl;
    vi.unstubAllGlobals();
  });

  it("validates an EdDSA Neon token and maps its non-UUID subject to a MobFlow profile", async () => {
    const { token, jwk } = makeToken();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ keys: [jwk] })));
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.auth_identity_links")) return { rows: [{ profile_id: PROFILE_ID }] };
      if (sql.includes("FROM public.profiles")) return {
        rows: [{
          id: PROFILE_ID,
          username: "teste.manager",
          account_id: ACCOUNT_ID,
          role: "manager",
          active: true,
          display_name: "Teste Manager",
          permissions: ["PDV", "Gerência"],
        }],
      };
      return { rows: [] };
    });

    const result = await beginAuthenticatedTransaction(request(token));

    expect(result.identity).toMatchObject({
      userId: PROFILE_ID,
      accountId: ACCOUNT_ID,
      role: "manager",
      username: "teste.manager",
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM public.auth_identity_links"),
      ["neon", AUTH_USER_ID],
    );
    expect(client.query).toHaveBeenCalledWith(
      "SELECT set_config('app.user_id', $1, true)",
      [PROFILE_ID],
    );
  });

  it("does not accept a Neon identity without an explicit MobFlow profile link", async () => {
    const { token, jwk } = makeToken();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ keys: [jwk] })));
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.auth_identity_links")) return { rows: [] };
      return { rows: [] };
    });

    await expect(beginAuthenticatedTransaction(request(token))).rejects.toMatchObject({
      status: 403,
      code: "identity_not_linked",
    });
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("FROM public.profiles"),
      expect.anything(),
    );
  });

  it("rejects a token with an invalid signature", async () => {
    const { token, jwk } = makeToken();
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ keys: [jwk] })));

    await expect(beginAuthenticatedTransaction(request(tampered))).rejects.toMatchObject({
      status: 401,
      code: "invalid_token",
    });
    expect(connect).not.toHaveBeenCalled();
  });
});
