import { Pool, type PoolClient } from "@neondatabase/serverless";

let pool: Pool | null = null;

export function getNeonPool(): Pool {
  if (typeof window !== "undefined") {
    throw new Error("Neon database access is server-only.");
  }

  const connectionString = process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    throw new Error("NEON_DATABASE_URL is not configured for this deployment.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  return pool;
}

export async function releaseTransaction(client: PoolClient, commit: boolean): Promise<void> {
  try {
    await client.query(commit ? "COMMIT" : "ROLLBACK");
  } finally {
    client.release();
  }
}

let signupPool: Pool | null = null;

/** Dedicated server-only database connection for public company onboarding.
 * The browser never receives this URL. Its PostgreSQL role is separately scoped
 * to billing lookup and the account-provisioning tables only.
 */
export function getSignupPool(): Pool {
  if (typeof window !== "undefined") {
    throw new Error("Signup database access is server-only.");
  }

  const connectionString = process.env.MOBFLOW_SIGNUP_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("MOBFLOW_SIGNUP_DATABASE_URL is not configured for this deployment.");
  }

  if (!signupPool) {
    signupPool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  return signupPool;
}
