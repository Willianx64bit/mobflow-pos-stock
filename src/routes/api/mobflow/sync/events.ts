import { createFileRoute } from "@tanstack/react-router";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;
const MAX_CURSOR = 9_223_372_036_854_775_807n;

type SyncEventRow = {
  event_id: string;
  sequence: string;
  category: string;
  delivery_mode: "automatic" | "manual";
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
};

function parseNonNegativeInteger(value: string | null, fallback: number): number | null {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export const Route = createFileRoute("/api/mobflow/sync/events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let transaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
        try {
          const url = new URL(request.url);
          const rawCursor = url.searchParams.get("cursor") ?? "0";
          const cursorIsValid = /^\d+$/.test(rawCursor) && BigInt(rawCursor) <= MAX_CURSOR;
          const requestedLimit = parseNonNegativeInteger(url.searchParams.get("limit"), DEFAULT_LIMIT);

          if (!cursorIsValid || requestedLimit === null || requestedLimit < 1) {
            return Response.json(
              { ok: false, error: "Cursor ou limite de sincronização inválido.", code: "invalid_sync_cursor" },
              { status: 400 },
            );
          }

          const limit = Math.min(requestedLimit, MAX_LIMIT);
          transaction = await beginAuthenticatedTransaction(request);
          const { client, identity } = transaction;

          // Tenant scope comes only from the authenticated server-side identity.
          // RLS independently applies app.account_id from this same transaction.
          const counterResult = await client.query<{ last_sequence: string }>(
            `SELECT last_sequence::text
             FROM public.mobflow_sync_counters
             WHERE tenant_id = $1
             LIMIT 1`,
            [identity.accountId],
          );
          const highWaterMark = counterResult.rows[0]?.last_sequence ?? "0";

          const eventsResult = await client.query<SyncEventRow>(
            `SELECT event_id, sequence::text, category, delivery_mode,
                    entity_type, entity_id, payload,
                    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
             FROM public.mobflow_sync_events
             WHERE tenant_id = $1
               AND sequence > $2::bigint
               AND sequence <= $3::bigint
               AND delivery_mode = 'automatic'
             ORDER BY sequence ASC
             LIMIT $4`,
            [identity.accountId, rawCursor, highWaterMark, limit + 1],
          );

          const hasMore = eventsResult.rows.length > limit;
          const page = eventsResult.rows.slice(0, limit);
          // Automatic consumers intentionally skip manual events; when the page is complete,
          // advance to the high-water mark so manual-only sequences are not fetched repeatedly.
          const nextCursor = hasMore ? page[page.length - 1].sequence : highWaterMark;

          await releaseTransaction(client, true);
          transaction = null;

          return Response.json({
            ok: true,
            events: page,
            cursor: rawCursor,
            nextCursor,
            highWaterMark,
            hasMore,
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
