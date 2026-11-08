import { createFileRoute } from "@tanstack/react-router";
import { createRealtime, rawSql } from "@neon/realtime/server";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

type LatestTenantEvent = { event_id: string };

let realtimeServer: ReturnType<typeof createRealtime> | null = null;

function getRealtimeServer() {
  const secret = process.env["NEON_REALTIME_SECRET"]?.trim();
  const databaseUrl = process.env["NEON_DATABASE_URL"]?.trim();
  if (!secret || !databaseUrl) {
    throw new Error("Neon Realtime is not configured for this Preview.");
  }

  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ""));
  if (!databaseName) throw new Error("Could not resolve the Neon database name.");

  if (!realtimeServer) {
    realtimeServer = createRealtime({ secret, db: databaseName });
  }
  return realtimeServer;
}

export const Route = createFileRoute("/api/mobflow/sync/live-query")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let transaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
        try {
          transaction = await beginAuthenticatedTransaction(request);
          const accountId = transaction.identity.accountId;
          await releaseTransaction(transaction.client, true);
          transaction = null;

          const query = rawSql<LatestTenantEvent>(
            `SELECT event_id
             FROM public.mobflow_sync_events
             WHERE tenant_id = $1
             ORDER BY sequence DESC
             LIMIT 1`,
            [accountId],
          );
          const sealedQuery = await getRealtimeServer().seal({ query });

          return Response.json(sealedQuery, {
            headers: { "Cache-Control": "no-store" },
          });
        } catch (error) {
          if (transaction) {
            try {
              await releaseTransaction(transaction.client, false);
            } catch {}
          }
          return jsonError(error);
        }
      },
    },
  },
});
