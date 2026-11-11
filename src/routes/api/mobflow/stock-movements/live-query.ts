import { createFileRoute } from "@tanstack/react-router";
import { createRealtime, rawSql } from "@neon/realtime/server";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

export type LiveStockMovement = {
  id: string;
  operationId: string;
  date: Date;
  type: string;
  productId: string;
  productCode: string | null;
  productName: string;
  unit: string;
  quantity: string;
  totalValue: string;
  stockBefore: string;
  stockAfter: string;
  delta: string;
  operator: string | null;
  details: string | null;
};

let realtimeServer: ReturnType<typeof createRealtime> | null = null;

function getRealtimeServer() {
  const secret = process.env["NEON_REALTIME_SECRET"]?.trim();
  const databaseUrl = process.env["NEON_DATABASE_URL"]?.trim();
  if (!secret || !databaseUrl) {
    throw new Error("Neon Realtime is not configured for this Preview.");
  }

  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ""));
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

          const query = rawSql<LiveStockMovement>(
            `SELECT
              id,
              operation_id AS "operationId",
              occurred_at AS date,
              operation_type AS type,
              product_id AS "productId",
              product_code AS "productCode",
              product_name AS "productName",
              unit,
              quantity,
              total_value AS "totalValue",
              stock_before AS "stockBefore",
              stock_after AS "stockAfter",
              delta,
              operator_snapshot AS operator,
              details
            FROM public.stock_movements
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
