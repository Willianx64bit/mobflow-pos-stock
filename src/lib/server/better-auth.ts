import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import bcrypt from "bcryptjs";
import { Pool } from "pg";

let pool: Pool | null = null;
let authInstance: ReturnType<typeof createAuthInstance> | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MobFlow Better Auth is not configured: ${name} is missing.`);
  return value;
}

function createAuthInstance(database: Pool, baseURL: string, secret: string, trustedOrigins: string[]) {
  return betterAuth({
    appName: "MobFlow",
    database,
    baseURL,
    secret,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: async (password) => bcrypt.hash(password, 12),
        verify: async ({ hash, password }) => bcrypt.compare(password, hash),
      },
    },
    advanced: {
      database: {
        // IDs are stored as text in the existing MobFlow auth tables.
        // Generate UUID strings in the app instead of relying on a DB UUID default.
        generateId: () => randomUUID(),
      },
    },
    plugins: [tanstackStartCookies()],
  });
}

/**
 * Self-managed Better Auth for the MobFlow migration.
 * This is separate from Neon Managed Auth's neon_auth schema.
 * Existing Supabase bcrypt hashes can be imported into Better Auth's
 * account.password column and verified by the custom bcrypt verifier.
 */
export function getMobFlowBetterAuth() {
  if (authInstance) return authInstance;

  const databaseUrl = process.env["MOBFLOW_AUTH_DATABASE_URL"]?.trim() || requiredEnv("NEON_DATABASE_URL");
  const secret = requiredEnv("BETTER_AUTH_SECRET");
  const baseURL = requiredEnv("BETTER_AUTH_URL");
  const trustedOrigins = (process.env["BETTER_AUTH_TRUSTED_ORIGINS"] || baseURL)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  authInstance = createAuthInstance(pool, baseURL, secret, trustedOrigins);

  return authInstance;
}
