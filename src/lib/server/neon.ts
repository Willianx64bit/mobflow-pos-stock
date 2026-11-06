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
