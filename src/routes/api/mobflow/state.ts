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
            `WITH scope AS (SELECT $1::uuid AS owner_id),
readiness AS (
  SELECT ($2::boolean AND (
    EXISTS (SELECT 1 FROM public.products p WHERE p.tenant_id = scope.owner_id)
    OR EXISTS (SELECT 1 FROM public.sales x WHERE x.tenant_id = scope.owner_id)
    OR EXISTS (SELECT 1 FROM public.cash_sessions x WHERE x.tenant_id = scope.owner_id)
    OR EXISTS (SELECT 1 FROM public.stock_movements x WHERE x.tenant_id = scope.owner_id)
    OR EXISTS (SELECT 1 FROM public.promotions x WHERE x.tenant_id = scope.owner_id)
  )) AS relational_ready
  FROM scope
)
SELECT
  CASE WHEN readiness.relational_ready THEN
    COALESCE(s.state, '{}'::jsonb) || jsonb_build_object(
      'products', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', p.id, 'code', p.code, 'barcodes', COALESCE((
            SELECT jsonb_agg(pb.barcode ORDER BY pb.is_primary DESC, pb.created_at)
            FROM public.product_barcodes pb
            WHERE pb.tenant_id = p.tenant_id AND pb.product_id = p.id
          ), '[]'::jsonb),
          'ref', p.reference, 'name', p.name, 'price', p.price, 'cost', p.cost,
          'stock', p.stock, 'minStock', p.min_stock, 'category', COALESCE(p.category, ''),
          'unit', p.unit
        ) ORDER BY p.name)
        FROM public.products p WHERE p.tenant_id = scope.owner_id
      ), '[]'::jsonb),
      'sales', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', sale.id, 'date', sale.occurred_at, 'cashSessionId', sale.cash_session_id,
          'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'productId', item.product_id, 'name', item.product_name_snapshot,
              'price', item.unit_price, 'cost', item.unit_cost,
              'qty', item.quantity, 'unit', item.unit
            ) ORDER BY item.line_key)
            FROM public.sale_items item
            WHERE item.tenant_id = sale.tenant_id AND item.sale_id = sale.id
          ), '[]'::jsonb),
          'total', sale.total, 'profit', sale.profit_total, 'subtotal', sale.subtotal,
          'discount', sale.discount_amount,
          'discountType', CASE sale.discount_type WHEN 'fixed' THEN 'R$' WHEN 'percentage' THEN '%' ELSE NULL END,
          'payment', CASE sale.payment_method WHEN 'cash' THEN 'Dinheiro' WHEN 'pix' THEN 'Pix' WHEN 'card' THEN 'Cartão' ELSE 'Fiado' END,
          'received', payment.received_amount, 'customer', sale.customer_name_snapshot,
          'cpf', sale.customer_document_snapshot, 'seller', sale.seller_snapshot,
          'paid', sale.payment_status = 'paid', 'paidAt', sale.paid_at,
          'hiddenFromFiado', sale.hidden_from_fiado,
          'payments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('value', rp.amount, 'date', rp.occurred_at) ORDER BY rp.occurred_at)
            FROM public.receivable_payments rp
            WHERE rp.tenant_id = sale.tenant_id AND rp.sale_id = sale.id
          ), '[]'::jsonb)
        ) ORDER BY sale.occurred_at DESC, sale.id)
        FROM public.sales sale
        LEFT JOIN LATERAL (
          SELECT sp.received_amount FROM public.sale_payments sp
          WHERE sp.tenant_id = sale.tenant_id AND sp.sale_id = sale.id
          ORDER BY sp.occurred_at DESC LIMIT 1
        ) payment ON true
        WHERE sale.tenant_id = scope.owner_id
      ), '[]'::jsonb),
      'cashSessions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', cs.id, 'openedAt', cs.opened_at,
          'openedBy', COALESCE((SELECT p.username FROM public.profiles p WHERE p.id = cs.operator_profile_id), cs.operator_snapshot),
          'operatorUsername', (SELECT p.username FROM public.profiles p WHERE p.id = cs.operator_profile_id),
          'openingAmount', cs.opening_amount, 'status', cs.status,
          'closedAt', cs.closed_at, 'closedBy', cs.closed_by_snapshot,
          'countedCash', cs.counted_amount, 'expectedCash', cs.expected_amount,
          'difference', cs.difference_amount, 'note', COALESCE(cs.closing_note, cs.opening_note)
        ) ORDER BY cs.opened_at DESC)
        FROM public.cash_sessions cs WHERE cs.tenant_id = scope.owner_id
      ), '[]'::jsonb),
      'cashMovements', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', cm.id, 'sessionId', cm.cash_session_id,
          'type', CASE cm.movement_type WHEN 'addition' THEN 'reforco' ELSE 'sangria' END,
          'amount', cm.amount, 'reason', cm.reason, 'operator', cm.operator_snapshot, 'date', cm.occurred_at
        ) ORDER BY cm.occurred_at DESC)
        FROM public.cash_movements cm WHERE cm.tenant_id = scope.owner_id
      ), '[]'::jsonb),
      'stockMovements', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', sm.id, 'operationId', sm.operation_id, 'date', sm.occurred_at,
          'type', CASE sm.operation_type WHEN 'writeoff' THEN 'Baixa' WHEN 'transfer' THEN 'Transferência' WHEN 'entry' THEN 'Entrada' WHEN 'adjustment' THEN CASE WHEN lower(COALESCE(sm.details,'')) LIKE '%balanço%' THEN 'Balanço' ELSE 'Ajuste de estoque' END ELSE sm.operation_type END,
          'productId', COALESCE(sm.product_id, 'legacy-product:' || sm.id),
          'productCode', sm.product_code, 'productName', sm.product_name, 'unit', sm.unit,
          'quantity', sm.quantity, 'totalValue', sm.total_value,
          'stockBefore', sm.stock_before, 'stockAfter', sm.stock_after, 'delta', sm.delta,
          'operator', sm.operator_snapshot, 'details', sm.details,
          'legacy', sm.source_kind <> 'live'
        ) ORDER BY sm.occurred_at DESC, sm.id)
        FROM public.stock_movements sm WHERE sm.tenant_id = scope.owner_id
      ), '[]'::jsonb),
      'stockAdjustments', CASE WHEN jsonb_array_length(COALESCE(s.state->'stockAdjustments','[]'::jsonb))>0 THEN s.state->'stockAdjustments' ELSE COALESCE((
        SELECT jsonb_agg(e.payload->'stockAdjustment' ORDER BY e.sequence DESC)
        FROM public.mobflow_sync_events e
        WHERE e.tenant_id=scope.owner_id AND e.entity_type='stock_operation'
          AND e.payload->>'operationType'='adjustment' AND jsonb_typeof(e.payload->'stockAdjustment')='object'
      ), '[]'::jsonb) END,
      'stockWriteoffs', CASE WHEN jsonb_array_length(COALESCE(s.state->'stockWriteoffs','[]'::jsonb))>0 THEN s.state->'stockWriteoffs' ELSE COALESCE((
        SELECT jsonb_agg(e.payload->'stockOperation' ORDER BY e.sequence DESC)
        FROM public.mobflow_sync_events e
        WHERE e.tenant_id=scope.owner_id AND e.entity_type='stock_writeoff'
          AND e.payload->>'operation'='upsert' AND jsonb_typeof(e.payload->'stockOperation')='object'
      ), '[]'::jsonb) END,
      'stockTransfers', CASE WHEN jsonb_array_length(COALESCE(s.state->'stockTransfers','[]'::jsonb))>0 THEN s.state->'stockTransfers' ELSE COALESCE((
        SELECT jsonb_agg(e.payload->'stockOperation' ORDER BY e.sequence DESC)
        FROM public.mobflow_sync_events e
        WHERE e.tenant_id=scope.owner_id AND e.entity_type='stock_transfer'
          AND e.payload->>'operation'='upsert' AND jsonb_typeof(e.payload->'stockOperation')='object'
      ), '[]'::jsonb) END,
      'promotions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', pr.id, 'productId', COALESCE(pr.product_id, ''),
          'productName', pr.product_name_snapshot, 'originalPrice', pr.original_price,
          'promoPrice', pr.promo_price, 'startsAt', COALESCE(pr.starts_at::text, ''),
          'endsAt', COALESCE(pr.ends_at::text, '')
        ) ORDER BY pr.id)
        FROM public.promotions pr WHERE pr.tenant_id = scope.owner_id
      ), '[]'::jsonb)
    )
  ELSE s.state END AS state,
  s.updated_at,
  COALESCE(c.last_sequence::text, '0') AS sync_cursor
FROM scope
CROSS JOIN readiness
LEFT JOIN public.app_state AS s ON s.owner_id = scope.owner_id
LEFT JOIN public.mobflow_sync_counters AS c ON c.tenant_id = scope.owner_id`,
            [transaction.identity.accountId, process.env["MOBFLOW_RELATIONAL_BOOTSTRAP_ENABLED"] === "true"],
          );
          const remote = remoteResult.rows[0];
          await releaseTransaction(transaction.client, true);
          transaction = null;

          const rawState = remote?.state && typeof remote.state === "object" ? remote.state as Record<string,unknown> : null;
          const privateContactIds = rawState && Array.isArray(rawState["contacts"])
            ? rawState["contacts"].map((item:any)=>typeof item?.id==="string"?item.id:null).filter((id):id is string=>!!id)
            : [];
          const safeState = rawState ? {
            ...rawState,
            contacts: [],
            settings: { companyName: typeof (rawState["settings"] as any)?.companyName === "string" ? (rawState["settings"] as any).companyName : "" },
          } : null;
          return Response.json({
            ok: true,
            state: safeState,
            privateContactIds,
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
              // Product catalog changes are written only through the transactional products API.
              // A whole-state snapshot is incomplete by design and must never create catalog
              // upsert/delete events: an omitted product is not a confirmed deletion.

              // Promotions are small, high-priority projections delivered in realtime. Keep the event projection
              // small and exclude unrelated state, customer data and payment settings.
              const oldPromotions = Array.isArray(previousState["promotions"])
                ? previousState["promotions"] as Array<Record<string, unknown>>
                : [];
              const nextPromotions = Array.isArray(nextState["promotions"])
                ? nextState["promotions"] as Array<Record<string, unknown>>
                : [];
              const oldPromotionsById = new Map(oldPromotions.map((promotion) => [String(promotion["id"] ?? ""), promotion]));
              const nextPromotionsById = new Map(nextPromotions.map((promotion) => [String(promotion["id"] ?? ""), promotion]));
              const promotionProjection = (promotion: Record<string, unknown>) => ({
                id: String(promotion["id"] ?? ""),
                productId: String(promotion["productId"] ?? ""),
                productName: String(promotion["productName"] ?? ""),
                originalPrice: finiteStateNumber(promotion["originalPrice"]),
                promoPrice: finiteStateNumber(promotion["promoPrice"]),
                startsAt: typeof promotion["startsAt"] === "string" ? promotion["startsAt"] : "",
                endsAt: typeof promotion["endsAt"] === "string" ? promotion["endsAt"] : "",
              });
              for (const promotion of nextPromotions) {
                const id = String(promotion["id"] ?? "");
                if (!id) continue;
                const previous = oldPromotionsById.get(id);
                const currentProjection = promotionProjection(promotion);
                if (!previous || JSON.stringify(promotionProjection(previous)) !== JSON.stringify(currentProjection)) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'promotions', 'automatic', 'promotion', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), id, JSON.stringify({ operation: "upsert", promotion: currentProjection })],
                  );
                }
              }
              for (const previous of oldPromotions) {
                const id = String(previous["id"] ?? "");
                if (id && !nextPromotionsById.has(id)) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'promotions', 'automatic', 'promotion', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), id, JSON.stringify({ operation: "delete" })],
                  );
                }
              }

              // Conference records are manual workflow events, separate from stock deltas.
              const oldConferences = Array.isArray(previousState["conferences"])
                ? previousState["conferences"] as Array<Record<string, unknown>>
                : [];
              const nextConferences = Array.isArray(nextState["conferences"])
                ? nextState["conferences"] as Array<Record<string, unknown>>
                : [];
              const oldConferencesById = new Map(oldConferences.map((item) => [String(item["id"] ?? ""), item]));
              const nextConferencesById = new Map(nextConferences.map((item) => [String(item["id"] ?? ""), item]));
              const conferenceProjection = (item: Record<string, unknown>) => ({
                id: String(item["id"] ?? ""),
                name: typeof item["name"] === "string" ? item["name"] : "",
                date: typeof item["date"] === "string" ? item["date"] : "",
                status: typeof item["status"] === "string" ? item["status"] : "",
                counts: item["counts"] && typeof item["counts"] === "object" && !Array.isArray(item["counts"]) ? item["counts"] : {},
                unknown: Array.isArray(item["unknown"]) ? item["unknown"] : [],
                adjusted: item["adjusted"] === true,
                receivingId: typeof item["receivingId"] === "string" ? item["receivingId"] : undefined,
                expiries: item["expiries"] && typeof item["expiries"] === "object" && !Array.isArray(item["expiries"]) ? item["expiries"] : {},
                extraCounts: item["extraCounts"] && typeof item["extraCounts"] === "object" && !Array.isArray(item["extraCounts"]) ? item["extraCounts"] : {},
                extraExpiries: item["extraExpiries"] && typeof item["extraExpiries"] === "object" && !Array.isArray(item["extraExpiries"]) ? item["extraExpiries"] : {},
              });
              for (const item of nextConferences) {
                const id = String(item["id"] ?? "");
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
                const id = String(previous["id"] ?? "");
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
                  id: String(item["id"] ?? ""), date: item["date"], reason: item["reason"], operator: item["operator"],
                  items: Array.isArray(item["items"]) ? item["items"].map((line: Record<string, unknown>) => ({
                    productId: line["productId"], code: line["code"], name: line["name"], unit: line["unit"],
                    mode: line["mode"], quantity: line["quantity"], previousStock: line["previousStock"], newStock: line["newStock"],
                  })) : [],
                }) },
                { key: "stockWriteoffs", entityType: "stock_writeoff", project: (item: Record<string, unknown>) => ({
                  id: String(item["id"] ?? ""), number: item["number"], date: item["date"], reason: item["reason"],
                  costMode: item["costMode"], operator: item["operator"],
                  items: Array.isArray(item["items"]) ? item["items"].map((line: Record<string, unknown>) => ({
                    productId: line["productId"], code: line["code"], name: line["name"], unit: line["unit"],
                    quantity: line["quantity"], previousStock: line["previousStock"], newStock: line["newStock"],
                  })) : [],
                }) },
                { key: "stockTransfers", entityType: "stock_transfer", project: (item: Record<string, unknown>) => ({
                  id: String(item["id"] ?? ""), number: item["number"], date: item["date"], reason: item["reason"],
                  destinationName: item["destinationName"], costMode: item["costMode"], operator: item["operator"],
                  items: Array.isArray(item["items"]) ? item["items"].map((line: Record<string, unknown>) => ({
                    productId: line["productId"], code: line["code"], name: line["name"], unit: line["unit"],
                    quantity: line["quantity"], previousStock: line["previousStock"], newStock: line["newStock"],
                  })) : [],
                }) },
              ] as const;
              for (const spec of stockOperationSpecs) {
                const oldItems = Array.isArray(previousState[spec.key])
                  ? previousState[spec.key] as Array<Record<string, unknown>> : [];
                const nextItems = Array.isArray(nextState[spec.key])
                  ? nextState[spec.key] as Array<Record<string, unknown>> : [];
                const oldMap = new Map(oldItems.map((item) => [String(item["id"] ?? ""), item]));
                const nextMap = new Map(nextItems.map((item) => [String(item["id"] ?? ""), item]));
                for (const item of nextItems) {
                  const id = String(item["id"] ?? "");
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
                  const id = String(previous["id"] ?? "");
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
              const oldExpiries = Array.isArray(previousState["manualExpiries"])
                ? previousState["manualExpiries"] as Array<Record<string, unknown>> : [];
              const nextExpiries = Array.isArray(nextState["manualExpiries"])
                ? nextState["manualExpiries"] as Array<Record<string, unknown>> : [];
              const oldExpiriesById = new Map(oldExpiries.map((item) => [String(item["id"] ?? ""), item]));
              const nextExpiriesById = new Map(nextExpiries.map((item) => [String(item["id"] ?? ""), item]));
              const expiryProjection = (item: Record<string, unknown>) => ({
                id: String(item["id"] ?? ""),
                productId: String(item["productId"] ?? ""),
                name: typeof item["name"] === "string" ? item["name"] : "",
                quantity: finiteStateNumber(item["quantity"]),
                expiry: typeof item["expiry"] === "string" ? item["expiry"] : "",
                unit: item["unit"] === "kg" ? "kg" : "un",
              });
              for (const item of nextExpiries) {
                const id = String(item["id"] ?? "");
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
                const id = String(previous["id"] ?? "");
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
                { key: "contacts", category: "master_data", entityType: "business_contact", idOf: (item: Record<string, unknown>) => String(item["id"] ?? ""), project: (item: Record<string, unknown>) => ({ id: String(item["id"] ?? ""), type: item["type"] }) },
                { key: "cashSessions", category: "master_data", entityType: "cash_session", idOf: (item: Record<string, unknown>) => String(item["id"] ?? ""), project: (item: Record<string, unknown>) => ({ id: String(item["id"] ?? ""), status: item["status"], openedAt: item["openedAt"], closedAt: item["closedAt"] }) },
                { key: "cashMovements", category: "master_data", entityType: "cash_movement", idOf: (item: Record<string, unknown>) => String(item["id"] ?? ""), project: (item: Record<string, unknown>) => ({ id: String(item["id"] ?? ""), sessionId: item["sessionId"], type: item["type"], amount: finiteStateNumber(item["amount"]), date: item["date"] }) },
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

              const oldSuppliers = Array.isArray(previousState["suppliers"]) ? previousState["suppliers"] as Array<Record<string, unknown>> : [];
              const nextSuppliers = Array.isArray(nextState["suppliers"]) ? nextState["suppliers"] as Array<Record<string, unknown>> : [];
              const supplierKey = (item: Record<string, unknown>) => typeof item["name"] === "string" ? item["name"].trim().toLocaleLowerCase() : "";
              const oldSupplierKeys = new Set(oldSuppliers.map(supplierKey).filter(Boolean));
              const nextSupplierKeys = new Set(nextSuppliers.map(supplierKey).filter(Boolean));
              for (const key of nextSupplierKeys) {
                const previous = oldSuppliers.find((item) => supplierKey(item) === key);
                const current = nextSuppliers.find((item) => supplierKey(item) === key);
                if (!previous || JSON.stringify({ name: previous["name"] }) !== JSON.stringify({ name: current?.["name"] })) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'master_data', 'manual', 'supplier', $3, $4::jsonb
                    )`,
                    [randomUUID(), randomUUID(), key.slice(0, 160), JSON.stringify({ operation: "upsert", name: current?.["name"] })],
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

              const oldSettings = previousState["settings"] && typeof previousState["settings"] === "object" ? previousState["settings"] as Record<string, unknown> : {};
              const nextSettings = nextState["settings"] && typeof nextState["settings"] === "object" ? nextState["settings"] as Record<string, unknown> : {};
              const safeSettingsKeys = ["companyName", "companyCnpj", "companyPhone", "companyStreet", "companyNumber", "companyCep", "companyComplement", "companyNeighborhood", "companyCity", "companyState"];
              const changedSettingsKeys = safeSettingsKeys.filter((key) => oldSettings[key] !== nextSettings[key]);
              if (changedSettingsKeys.length) {
                await client.query(
                  `SELECT public.mobflow_append_sync_event(
                    $1::uuid, $2::uuid, 'settings', 'manual', 'company_settings', 'company', $3::jsonb
                  )`,
                  [randomUUID(), randomUUID(), JSON.stringify({ operation: "changed", keys: changedSettingsKeys, values: changedSettingsKeys.includes("companyName") ? { companyName: nextSettings["companyName"] } : {} })],
                );
              }

              for (const product of nextProducts) {
                const id = String(product["id"] ?? "");
                const previous = oldById.get(id);
                if (!id || !previous) continue;

                const oldStock = finiteStateNumber(previous["stock"]);
                const nextStock = finiteStateNumber(product["stock"]);
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

                const oldPrice = finiteStateNumber(previous["price"]);
                const nextPrice = finiteStateNumber(product["price"]);
                if (oldPrice !== null && nextPrice !== null && oldPrice !== nextPrice) {
                  await client.query(
                    `SELECT public.mobflow_append_sync_event(
                      $1::uuid, $2::uuid, 'price', 'manual', 'product', $3, $4::jsonb
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
