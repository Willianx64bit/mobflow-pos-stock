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
              const nextById = new Map(nextProducts.map((product) => [String(product.id ?? ""), product]));
              const catalogFields = ["code", "barcodes", "ref", "name", "cost", "minStock", "category", "unit"] as const;
              const catalogSnapshot = (product: Record<string, unknown>) =>
                Object.fromEntries(catalogFields
                  .filter((field) => product[field] !== undefined)
                  .map((field) => [field, product[field]]));

              // Catalog events deliberately exclude photos, stock and sale price:
              // photos move to object storage later; stock/price have dedicated events.
              for (const product of nextProducts) {
                const id = String(product.id ?? "");
                if (!id) continue;
                const previous = oldById.get(id);
                const currentCatalog = catalogSnapshot(product);
                if (!previous) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'catalog', 'manual', 'product', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), id, JSON.stringify({ operation: "upsert", product: currentCatalog })],
                  );
                  continue;
                }
                const previousCatalog = catalogSnapshot(previous);
                if (JSON.stringify(previousCatalog) !== JSON.stringify(currentCatalog)) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'catalog', 'manual', 'product', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), id, JSON.stringify({ operation: "upsert", product: currentCatalog })],
                  );
                }
              }

              for (const previous of oldProducts) {
                const id = String(previous.id ?? "");
                if (id && !nextById.has(id)) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'catalog', 'manual', 'product', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), id, JSON.stringify({ operation: "delete" })],
                  );
                }
              }

              // Promotions are manual catalog operations. Keep the event projection
              // small and exclude unrelated state, customer data and payment settings.
              const oldPromotions = Array.isArray(previousState.promotions)
                ? previousState.promotions as Array<Record<string, unknown>>
                : [];
              const nextPromotions = Array.isArray(nextState.promotions)
                ? nextState.promotions as Array<Record<string, unknown>>
                : [];
              const oldPromotionsById = new Map(oldPromotions.map((promotion) => [String(promotion.id ?? ""), promotion]));
              const nextPromotionsById = new Map(nextPromotions.map((promotion) => [String(promotion.id ?? ""), promotion]));
              const promotionProjection = (promotion: Record<string, unknown>) => ({
                id: String(promotion.id ?? ""),
                productId: String(promotion.productId ?? ""),
                productName: String(promotion.productName ?? ""),
                originalPrice: finiteStateNumber(promotion.originalPrice),
                promoPrice: finiteStateNumber(promotion.promoPrice),
                startsAt: typeof promotion.startsAt === "string" ? promotion.startsAt : "",
                endsAt: typeof promotion.endsAt === "string" ? promotion.endsAt : "",
              });
              for (const promotion of nextPromotions) {
                const id = String(promotion.id ?? "");
                if (!id) continue;
                const previous = oldPromotionsById.get(id);
                const currentProjection = promotionProjection(promotion);
                if (!previous || JSON.stringify(promotionProjection(previous)) !== JSON.stringify(currentProjection)) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'promotions', 'manual', 'promotion', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), id, JSON.stringify({ operation: "upsert", promotion: currentProjection })],
                  );
                }
              }
              for (const previous of oldPromotions) {
                const id = String(previous.id ?? "");
                if (id && !nextPromotionsById.has(id)) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'promotions', 'manual', 'promotion', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), id, JSON.stringify({ operation: "delete" })],
                  );
                }
              }

              // Conference records are manual workflow events, separate from stock deltas.
              const oldConferences = Array.isArray(previousState.conferences)
                ? previousState.conferences as Array<Record<string, unknown>>
                : [];
              const nextConferences = Array.isArray(nextState.conferences)
                ? nextState.conferences as Array<Record<string, unknown>>
                : [];
              const oldConferencesById = new Map(oldConferences.map((item) => [String(item.id ?? ""), item]));
              const nextConferencesById = new Map(nextConferences.map((item) => [String(item.id ?? ""), item]));
              const conferenceProjection = (item: Record<string, unknown>) => ({
                id: String(item.id ?? ""),
                name: typeof item.name === "string" ? item.name : "",
                date: typeof item.date === "string" ? item.date : "",
                status: typeof item.status === "string" ? item.status : "",
                counts: item.counts && typeof item.counts === "object" && !Array.isArray(item.counts) ? item.counts : {},
                unknown: Array.isArray(item.unknown) ? item.unknown : [],
                adjusted: item.adjusted === true,
                receivingId: typeof item.receivingId === "string" ? item.receivingId : undefined,
                expiries: item.expiries && typeof item.expiries === "object" && !Array.isArray(item.expiries) ? item.expiries : {},
                extraCounts: item.extraCounts && typeof item.extraCounts === "object" && !Array.isArray(item.extraCounts) ? item.extraCounts : {},
                extraExpiries: item.extraExpiries && typeof item.extraExpiries === "object" && !Array.isArray(item.extraExpiries) ? item.extraExpiries : {},
              });
              for (const item of nextConferences) {
                const id = String(item.id ?? "");
                if (!id) continue;
                const previous = oldConferencesById.get(id);
                const projection = conferenceProjection(item);
                if (!previous || JSON.stringify(conferenceProjection(previous)) !== JSON.stringify(projection)) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'conference', 'manual', 'conference', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), id, JSON.stringify({ operation: "upsert", conference: projection })],
                  );
                }
              }
              for (const previous of oldConferences) {
                const id = String(previous.id ?? "");
                if (id && !nextConferencesById.has(id)) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'conference', 'manual', 'conference', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), id, JSON.stringify({ operation: "delete" })],
                  );
                }
              }

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
