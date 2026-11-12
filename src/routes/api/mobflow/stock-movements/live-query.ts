import { createFileRoute } from "@tanstack/react-router";
import { createRealtime, rawSql } from "@neon/realtime/server";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

type LatestTenantSignal = { last_sequence: string };

let realtimeServer: ReturnType<typeof createRealtime> | null = null;

function getRealtimeServer() {
  const secret = process.env["NEON_REALTIME_SECRET"]?.trim();
  const databaseUrl = process.env["NEON_DATABASE_URL"]?.trim();
  if (!secret || !databaseUrl) {
    throw new Error("Neon Realtime is not configured for this Preview.");
  }

  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\\/+/, ""));
  if (!databaseName) throw new Error("Could not resolve the Neon database name.");

  if (!realtimeServer) realtimeServer = createRealtime({ secret, db: databaseName });
  return realtimeServer;
}

export const Route = createFileRoute("/api/mobflow/stock-movements/live-query")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let transaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
        try {
          transaction = await beginAuthenticatedTransaction(request);
          const accountId = transaction.identity.accountId;
          await releaseTransaction(transaction.client, true);
          transaction = null;

          // Neon Realtime rejects RLS-protected tables. Subscribe only to the
          // minimal tenant signal, then fetch the protected ledger through our
          // authenticated API whenever its sequence changes.
          const query = rawSql<LatestTenantSignal>(
            `SELECT last_sequence::text AS last_sequence
             FROM public.mobflow_realtime_signals
             WHERE tenant_id = $1::uuid`,
            [accountId],
          );
          const sealedQuery = await getRealtimeServer().seal({ query });
          return Response.json(sealedQuery, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          if (transaction) {
            try { await releaseTransaction(transaction.client, false); } catch {}
          }
          return jsonError(error);
        }
      },
    },
  },
});
