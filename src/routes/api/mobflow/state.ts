import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

const MAX_STATE_BYTES = 8 * 1024 * 1024;

type StateRow = { state: unknown; updated_at: string };

function finiteStateNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readRemoteState(client: Awaited<ReturnType<typeof beginAuthenticatedTransaction>>["client"], accountId: string) {
  const result = await client.query<StateRow>(
    "SELECT state, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS updated_at FROM public.app_state WHERE owner_id = $1 LIMIT 1",
    [accountId],
  );
  return result.rows[0] ?? null;
}

export const Route = createFileRoute("/api/mobflow/state")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let transaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
        try {
          transaction = await beginAuthenticatedTransaction(request);
          const remote = await readRemoteState(transaction.client, transaction.identity.accountId);
          await releaseTransaction(transaction.client, true);
          transaction = null;

          return Response.json({
            ok: true,
            state: remote?.state ?? null,
            updatedAt: remote?.updated_at ?? null,
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

      PUT: async ({ request }) => {
        let transaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
        try {
          const rawBody = await request.text();
          if (new TextEncoder().encode(rawBody).byteLength > MAX_STATE_BYTES) {
            return Response.json(
              { ok: false, error: "O estado enviado excede o limite permitido.", code: "payload_too_large" },
              { status: 413 },
            );
          }

          let parsedBody: unknown;
          try {
            parsedBody = JSON.parse(rawBody) as unknown;
          } catch {
            return Response.json(
              { ok: false, error: "Corpo da requisição inválido.", code: "invalid_json" },
              { status: 400 },
            );
          }

          if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
            return Response.json(
              { ok: false, error: "O corpo da requisição deve ser um objeto JSON.", code: "invalid_body" },
              { status: 400 },
            );
          }

          const body = parsedBody as { state?: unknown; expectedUpdatedAt?: unknown };

          if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
            return Response.json(
              { ok: false, error: "O campo state deve ser um objeto JSON.", code: "invalid_state" },
              { status: 400 },
            );
          }

          const expected = body.expectedUpdatedAt ?? null;
          if (
            expected !== null &&
            (typeof expected !== "string" || Number.isNaN(Date.parse(expected)))
          ) {
            return Response.json(
              { ok: false, error: "Versão esperada inválida.", code: "invalid_version" },
              { status: 400 },
            );
          }

          transaction = await beginAuthenticatedTransaction(request);
          const { client } = transaction;
          const accountId = transaction.identity.accountId;
          const serializedState = JSON.stringify(body.state);

          if (expected === null) {
            const inserted = await client.query<{ updated_at: string }>(
              `INSERT INTO public.app_state (owner_id, state, updated_at)
               VALUES ($1, $2::jsonb, clock_timestamp())
               ON CONFLICT (owner_id) DO NOTHING
               RETURNING to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS updated_at`,
              [accountId, serializedState],
            );

            if (inserted.rows[0]) {
              await releaseTransaction(client, true);
              transaction = null;
              return Response.json({ ok: true, status: "saved", updatedAt: inserted.rows[0].updated_at });
            }
          } else {
            const previousResult = await client.query<{ state: Record<string, unknown> }>(
              `SELECT state
               FROM public.app_state
               WHERE owner_id = $1
                 AND updated_at = $2::timestamptz
               FOR UPDATE`,
              [accountId, expected],
            );
            const previousState = previousResult.rows[0]?.state ?? null;

            const updated = previousState
              ? await client.query<{ updated_at: string }>(
                  `UPDATE public.app_state
                   SET state = $1::jsonb,
                       updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')
                   WHERE owner_id = $2
                     AND updated_at = $3::timestamptz
                   RETURNING to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`,
                  [serializedState, accountId, expected],
                )
              : { rows: [] as Array<{ updated_at: string }> };

            if (updated.rows[0] && previousState) {
              const oldProducts = Array.isArray(previousState.products)
                ? previousState.products as Array<Record<string, unknown>>
                : [];
              const nextState = body.state as Record<string, unknown>;
              const nextProducts = Array.isArray(nextState.products)
                ? nextState.products as Array<Record<string, unknown>>
                : [];
              const oldById = new Map(oldProducts.map((product) => [String(product.id ?? ""), product]));

              for (const product of nextProducts) {
                const id = String(product.id ?? "");
                const previous = oldById.get(id);
                if (!id || !previous) continue;

                const oldStock = finiteStateNumber(previous.stock);
                const nextStock = finiteStateNumber(product.stock);
                if (oldStock !== null && nextStock !== null && oldStock !== nextStock) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'stock', 'automatic', 'product', $3, $4::jsonb
                    )`,
                    [
                      randomUUID(),
                      randomUUID(),
                      id,
                      JSON.stringify({ stockDelta: nextStock - oldStock, resultingStock: nextStock, source: "state_update" }),
                    ],
                  );
                }

                const oldPrice = finiteStateNumber(previous.price);
                const nextPrice = finiteStateNumber(product.price);
                if (oldPrice !== null && nextPrice !== null && oldPrice !== nextPrice) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'price', 'automatic', 'product', $3, $4::jsonb
                    )`,
                    [
                      randomUUID(),
                      randomUUID(),
                      id,
                      JSON.stringify({ price: nextPrice, previousPrice: oldPrice, source: "state_update" }),
                    ],
                  );
                }
              }

              await releaseTransaction(client, true);
              transaction = null;
              return Response.json({ ok: true, status: "saved", updatedAt: updated.rows[0].updated_at });
            }
          }

          const remote = await readRemoteState(client, accountId);
          await releaseTransaction(client, true);
          transaction = null;

          return Response.json(
            {
              ok: false,
              status: "conflict",
              code: "version_conflict",
              error: "O estado remoto foi atualizado por outro dispositivo.",
              remoteState: remote?.state ?? null,
              remoteUpdatedAt: remote?.updated_at ?? null,
            },
            { status: 409 },
          );
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
