import { createFileRoute } from "@tanstack/react-router";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

type StockMovementRow = {
  id: string;
  operationId: string;
  date: string;
  type: string;
  productId: string | null;
  productCode: string | null;
  productName: string;
  unit: string;
  quantity: string;
  totalValue: string;
  stockBefore: string | null;
  stockAfter: string | null;
  delta: string;
  operator: string | null;
  details: string | null;
};

export const Route = createFileRoute("/api/mobflow/stock-movements/list")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let transaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
        try {
          transaction = await beginAuthenticatedTransaction(request);
          const { client, identity } = transaction;
          const result = await client.query<StockMovementRow>(
            `SELECT
              id,
              operation_id AS "operationId",
              to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS date,
              operation_type AS type,
              product_id AS "productId",
              product_code AS "productCode",
              product_name AS "productName",
              unit,
              quantity::text AS quantity,
              total_value::text AS "totalValue",
              stock_before::text AS "stockBefore",
              stock_after::text AS "stockAfter",
              delta::text AS delta,
              operator_snapshot AS operator,
              details
            FROM public.stock_movements
            WHERE tenant_id = $1
            ORDER BY occurred_at DESC, id DESC
            LIMIT 2000`,
            [identity.accountId],
          );
          await releaseTransaction(client, true);
          transaction = null;
          return Response.json({ ok: true, movements: result.rows }, {
            headers: { "Cache-Control": "no-store" },
          });
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
