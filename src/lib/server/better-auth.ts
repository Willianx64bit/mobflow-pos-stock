import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import bcrypt from "bcryptjs";
import { Pool } from "pg";

let pool: Pool | null = null;
let authInstance: ReturnType<typeof betterAuth> | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MobFlow Better Auth is not configured: ${name} is missing.`);
  return value;
}

/**
 * Self-managed Better Auth for the MobFlow migration.
 * This is separate from Neon Managed Auth's neon_auth schema.
 * Existing Supabase bcrypt hashes can be imported into Better Auth's
 * account.password column and verified by the custom bcrypt verifier.
 */
export function getMobFlowBetterAuth() {
  if (authInstance) return authInstance;

  const databaseUrl = requiredEnv("MOBFLOW_AUTH_DATABASE_URL");
  const secret = requiredEnv("BETTER_AUTH_SECRET");
  const baseURL = requiredEnv("BETTER_AUTH_URL");
  const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS || baseURL)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  authInstance = betterAuth({
    appName: "MobFlow",
    database: pool,
    baseURL,
    secret,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      password: {
        hash: async (password) => bcrypt.hash(password, 12),
        verify: async ({ hash, password }) => bcrypt.compare(password, hash),
      },
    },
    advanced: {
      database: {
        // MobFlow profiles and company rows use UUID IDs.
        generateId: "uuid",
      },
    },
    plugins: [tanstackStartCookies()],
  });

  return authInstance;
}
