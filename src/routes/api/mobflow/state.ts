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
          // Read the snapshot and its event high-water mark in one SQL statement.
          // This gives the client a cursor consistent with the bootstrap snapshot.
          const remoteResult = await transaction.client.query<{
            state: Record<string, unknown> | null;
            updated_at: string | null;
            sync_cursor: string;
          }>(
            `SELECT s.state, s.updated_at, COALESCE(c.last_sequence::text, '0') AS sync_cursor
             FROM (SELECT $1::uuid AS owner_id) AS scope
             LEFT JOIN public.app_state AS s ON s.owner_id = scope.owner_id
             LEFT JOIN public.mobflow_sync_counters AS c ON c.tenant_id = scope.owner_id`,
            [transaction.identity.accountId],
          );
          const remote = remoteResult.rows[0];
          await releaseTransaction(transaction.client, true);
          transaction = null;

          return Response.json({
            ok: true,
            state: remote?.state ?? null,
            updatedAt: remote?.updated_at ?? null,
            syncCursor: remote?.sync_cursor ?? "0",
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

              // Manual stock-operation audit events. The corresponding product balance
              // changes remain emitted separately as automatic stock delta events below.
              const stockOperationSpecs = [
                { key: "stockAdjustments", entityType: "stock_adjustment", project: (item: Record<string, unknown>) => ({
                  id: String(item.id ?? ""), date: item.date, reason: item.reason, operator: item.operator,
                  items: Array.isArray(item.items) ? item.items.map((line: Record<string, unknown>) => ({
                    productId: line.productId, code: line.code, name: line.name, unit: line.unit,
                    mode: line.mode, quantity: line.quantity, previousStock: line.previousStock, newStock: line.newStock,
                  })) : [],
                }) },
                { key: "stockWriteoffs", entityType: "stock_writeoff", project: (item: Record<string, unknown>) => ({
                  id: String(item.id ?? ""), number: item.number, date: item.date, reason: item.reason,
                  costMode: item.costMode, operator: item.operator,
                  items: Array.isArray(item.items) ? item.items.map((line: Record<string, unknown>) => ({
                    productId: line.productId, code: line.code, name: line.name, unit: line.unit,
                    quantity: line.quantity, previousStock: line.previousStock, newStock: line.newStock,
                  })) : [],
                }) },
                { key: "stockTransfers", entityType: "stock_transfer", project: (item: Record<string, unknown>) => ({
                  id: String(item.id ?? ""), number: item.number, date: item.date, reason: item.reason,
                  destinationName: item.destinationName, costMode: item.costMode, operator: item.operator,
                  items: Array.isArray(item.items) ? item.items.map((line: Record<string, unknown>) => ({
                    productId: line.productId, code: line.code, name: line.name, unit: line.unit,
                    quantity: line.quantity, previousStock: line.previousStock, newStock: line.newStock,
                  })) : [],
                }) },
              ] as const;
              for (const spec of stockOperationSpecs) {
                const oldItems = Array.isArray(previousState[spec.key])
                  ? previousState[spec.key] as Array<Record<string, unknown>> : [];
                const nextItems = Array.isArray(nextState[spec.key])
                  ? nextState[spec.key] as Array<Record<string, unknown>> : [];
                const oldMap = new Map(oldItems.map((item) => [String(item.id ?? ""), item]));
                const nextMap = new Map(nextItems.map((item) => [String(item.id ?? ""), item]));
                for (const item of nextItems) {
                  const id = String(item.id ?? "");
                  if (!id) continue;
                  const projection = spec.project(item);
                  const previous = oldMap.get(id);
                  if (!previous || JSON.stringify(spec.project(previous)) !== JSON.stringify(projection)) {
                    const payload = JSON.stringify({ operation: "upsert", stockOperation: projection });
                    if (new TextEncoder().encode(payload).byteLength > 15000) {
                      throw new Error("A operação de estoque excede o limite seguro de sincronização.");
                    }
                    await client.query(
                      `SELECT public.mobflow_append_sync_event(
                        $1::uuid, $2::uuid, 'stock', 'manual', $3, $4, $5::jsonb
                      )`,
                      [randomUUID(), randomUUID(), spec.entityType, id, payload],
                    );
                  }
                }
                for (const previous of oldItems) {
                  const id = String(previous.id ?? "");
                  if (id && !nextMap.has(id)) {
                    await client.query(
                      `SELECT public.mobflow_append_sync_event(
                        $1::uuid, $2::uuid, 'stock', 'manual', $3, $4, $5::jsonb
                      )`,
                      [randomUUID(), randomUUID(), spec.entityType, id, JSON.stringify({ operation: "delete" })],
                    );
                  }
                }
              }

              // Manual expiry records are master-data workflow events. Keep only the
              // fields required to reproduce the expiry entry on another device.
              const oldExpiries = Array.isArray(previousState.manualExpiries)
                ? previousState.manualExpiries as Array<Record<string, unknown>> : [];
              const nextExpiries = Array.isArray(nextState.manualExpiries)
                ? nextState.manualExpiries as Array<Record<string, unknown>> : [];
              const oldExpiriesById = new Map(oldExpiries.map((item) => [String(item.id ?? ""), item]));
              const nextExpiriesById = new Map(nextExpiries.map((item) => [String(item.id ?? ""), item]));
              const expiryProjection = (item: Record<string, unknown>) => ({
                id: String(item.id ?? ""),
                productId: String(item.productId ?? ""),
                name: typeof item.name === "string" ? item.name : "",
                quantity: finiteStateNumber(item.quantity),
                expiry: typeof item.expiry === "string" ? item.expiry : "",
                unit: item.unit === "kg" ? "kg" : "un",
              });
              for (const item of nextExpiries) {
                const id = String(item.id ?? "");
                if (!id) continue;
                const projection = expiryProjection(item);
                const previous = oldExpiriesById.get(id);
                if (!previous || JSON.stringify(expiryProjection(previous)) !== JSON.stringify(projection)) {
                  const payload = JSON.stringify({ operation: "upsert", manualExpiry: projection });
                  if (new TextEncoder().encode(payload).byteLength > 15000) {
                    throw new Error("O registro de validade excede o limite seguro de sincronização.");
                  }
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'master_data', 'manual', 'manual_expiry', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), id, payload],
                  );
                }
              }
              for (const previous of oldExpiries) {
                const id = String(previous.id ?? "");
                if (id && !nextExpiriesById.has(id)) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'master_data', 'manual', 'manual_expiry', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), id, JSON.stringify({ operation: "delete" })],
                  );
                }
              }

              // Redacted operational metadata events. The full records continue to
              // travel through the authenticated app_state snapshot; the event
              // ledger intentionally never copies customer contact details,
              // supplier documents, sale/customer data, or payment secrets.
              const metadataCollections = [
                { key: "contacts", category: "master_data", entityType: "business_contact", idOf: (item: Record<string, unknown>) => String(item.id ?? ""), project: (item: Record<string, unknown>) => ({ id: String(item.id ?? ""), type: item.type }) },
                { key: "cashSessions", category: "master_data", entityType: "cash_session", idOf: (item: Record<string, unknown>) => String(item.id ?? ""), project: (item: Record<string, unknown>) => ({ id: String(item.id ?? ""), status: item.status, openedAt: item.openedAt, closedAt: item.closedAt }) },
                { key: "cashMovements", category: "master_data", entityType: "cash_movement", idOf: (item: Record<string, unknown>) => String(item.id ?? ""), project: (item: Record<string, unknown>) => ({ id: String(item.id ?? ""), sessionId: item.sessionId, type: item.type, amount: finiteStateNumber(item.amount), date: item.date }) },
              ] as const;
              for (const spec of metadataCollections) {
                const oldItems = Array.isArray(previousState[spec.key]) ? previousState[spec.key] as Array<Record<string, unknown>> : [];
                const nextItems = Array.isArray(nextState[spec.key]) ? nextState[spec.key] as Array<Record<string, unknown>> : [];
                const oldMap = new Map(oldItems.map((item) => [spec.idOf(item), item]));
                const nextMap = new Map(nextItems.map((item) => [spec.idOf(item), item]));
                for (const item of nextItems) {
                  const id = spec.idOf(item);
                  if (!id) continue;
                  const projection = spec.project(item);
                  const previous = oldMap.get(id);
                  if (!previous || JSON.stringify(spec.project(previous)) !== JSON.stringify(projection)) {
                    await client.query(
                      `SELECT public.mobflow_append_sync_event(
                        $1::uuid, $2::uuid, $3, 'manual', $4, $5, $6::jsonb
                      )`,
                      [randomUUID(), randomUUID(), spec.category, spec.entityType, id, JSON.stringify({ operation: "upsert", metadata: projection })],
                    );
                  }
                }
                for (const previous of oldItems) {
                  const id = spec.idOf(previous);
                  if (id && !nextMap.has(id)) {
                    await client.query(
                      `SELECT public.mobflow_append_sync_event(
                        $1::uuid, $2::uuid, $3, 'manual', $4, $5, $6::jsonb
                      )`,
                      [randomUUID(), randomUUID(), spec.category, spec.entityType, id, JSON.stringify({ operation: "delete" })],
                    );
                  }
                }
              }

              const oldSuppliers = Array.isArray(previousState.suppliers) ? previousState.suppliers as Array<Record<string, unknown>> : [];
              const nextSuppliers = Array.isArray(nextState.suppliers) ? nextState.suppliers as Array<Record<string, unknown>> : [];
              const supplierKey = (item: Record<string, unknown>) => typeof item.name === "string" ? item.name.trim().toLocaleLowerCase() : "";
              const oldSupplierKeys = new Set(oldSuppliers.map(supplierKey).filter(Boolean));
              const nextSupplierKeys = new Set(nextSuppliers.map(supplierKey).filter(Boolean));
              for (const key of nextSupplierKeys) {
                const previous = oldSuppliers.find((item) => supplierKey(item) === key);
                const current = nextSuppliers.find((item) => supplierKey(item) === key);
                if (!previous || JSON.stringify({ name: previous.name }) !== JSON.stringify({ name: current?.name })) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'master_data', 'manual', 'supplier', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), key.slice(0, 160), JSON.stringify({ operation: "upsert", name: current?.name })],
                  );
                }
              }
              for (const key of oldSupplierKeys) {
                if (!nextSupplierKeys.has(key)) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'master_data', 'manual', 'supplier', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), key.slice(0, 160), JSON.stringify({ operation: "delete" })],
                  );
                }
              }

              const oldSettings = previousState.settings && typeof previousState.settings === "object" ? previousState.settings as Record<string, unknown> : {};
              const nextSettings = nextState.settings && typeof nextState.settings === "object" ? nextState.settings as Record<string, unknown> : {};
              const safeSettingsKeys = ["companyName", "companyCnpj", "companyPhone", "companyStreet", "companyNumber", "companyCep", "companyComplement", "companyNeighborhood", "companyCity", "companyState"];
              const changedSettingsKeys = safeSettingsKeys.filter((key) => oldSettings[key] !== nextSettings[key]);
              if (changedSettingsKeys.length) {
                await client.query(
                  `SELECT public.mobflow_append_sync_event(
                    $1::uuid, $2::uuid, 'settings', 'manual', 'company_settings', 'company', $3::jsonb
                  )`,
                  [randomUUID(), randomUUID(), JSON.stringify({ operation: "changed", keys: changedSettingsKeys })],
                );
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
