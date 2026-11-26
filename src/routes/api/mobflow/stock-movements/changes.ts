import { createFileRoute } from "@tanstack/react-router";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

const MAX_CURSOR = 9_223_372_036_854_775_807n;

type StockMovementChangesRow = {
  highWaterMark: string;
  hasStockChanges: boolean;
};

export const Route = createFileRoute("/api/mobflow/stock-movements/changes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let transaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
        try {
          const url = new URL(request.url);
          const cursor = url.searchParams.get("cursor") ?? "0";
          if (!/^\\d+$/.test(cursor) || BigInt(cursor) > MAX_CURSOR) {
            return Response.json(
              { ok: false, error: "Cursor de movimentações inválido.", code: "invalid_stock_movement_cursor" },
              { status: 400 },
            );
          }

          transaction = await beginAuthenticatedTransaction(request);
          const { client, identity } = transaction;
          const result = await client.query<StockMovementChangesRow>(
            `WITH high_water AS (
               SELECT COALESCE(MAX(last_sequence), 0)::bigint AS sequence
               FROM public.mobflow_sync_counters
               WHERE tenant_id = $1
             )
             SELECT
               high_water.sequence::text AS "highWaterMark",
               EXISTS (
                 SELECT 1
                 FROM public.mobflow_sync_events AS event
                 WHERE event.tenant_id = $1
                   AND event.delivery_mode = 'automatic'
                   AND event.category = 'stock'
                   AND event.sequence > $2::bigint
                   AND event.sequence <= high_water.sequence
               ) AS "hasStockChanges"
             FROM high_water`,
            [identity.accountId, cursor],
          );

          await releaseTransaction(client, true);
          transaction = null;
          const row = result.rows[0];
          return Response.json({
            ok: true,
            highWaterMark: row?.highWaterMark ?? cursor,
            hasStockChanges: row?.hasStockChanges ?? false,
          }, { headers: { "Cache-Control": "no-store" } });
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
