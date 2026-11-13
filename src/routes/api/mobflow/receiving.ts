import { createHash, randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

type ReceiveLine = { productId?: string; received?: number };
function stableIdempotencyUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type ReceivingNote = {
  id?: string;
  status?: string;
  decisionCompleted?: boolean;
  stockReleased?: boolean;
  items?: ReceiveLine[];
  extras?: ReceiveLine[];
  decisions?: Record<string, string>;
  [key: string]: unknown;
};

export async function handleMobFlowReceiving(request: Request) {
  if (process.env["MOBFLOW_AUTH_PROVIDER"] !== "better-auth") {
    return Response.json({ ok: false, error: "Este fluxo ainda não está ativo neste ambiente." }, { status: 503 });
  }

  let transaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body["action"] ?? "");
    const receivingId = String(body["receivingId"] ?? "");
    if (action === "save_conference") {
      const conference = body["conference"] as Record<string,unknown> | undefined;
      if (!conference || typeof conference["id"] !== "string" || typeof conference["receivingId"] !== "string" || !conference["receivingId"]) {
        return Response.json({ok:false,error:"Conferência de recebimento inválida."},{status:400});
      }
      transaction = await beginAuthenticatedTransaction(request);
      const client = transaction.client;
      const row = await client.query<{state:Record<string,unknown>}>("SELECT state FROM public.app_state WHERE owner_id=$1 FOR UPDATE",[transaction.identity.accountId]);
      const state = row.rows[0]?.state;
      if (!state || typeof state !== "object") { await releaseTransaction(client,false);transaction=null;return Response.json({ok:false,error:"Dados da empresa não encontrados."},{status:404}); }
      const receiving = Array.isArray(state["receiving"]) ? state["receiving"] as ReceivingNote[] : [];
      if (!receiving.some((note)=>note.id===conference["receivingId"])) { await releaseTransaction(client,false);transaction=null;return Response.json({ok:false,error:"Recebimento relacionado não encontrado."},{status:404}); }
      const conferences = Array.isArray(state["conferences"]) ? state["conferences"] as Array<Record<string,unknown>> : [];
      const saved = conferences.some((item)=>item["id"]===conference["id"])
        ? conferences.map((item)=>item["id"]===conference["id"]?conference:item)
        : [conference,...conferences];
      await client.query("UPDATE public.app_state SET state=jsonb_set(state,'{conferences}',$2::jsonb,true),updated_at=now() WHERE owner_id=$1",[transaction.identity.accountId,JSON.stringify(saved)]);
      await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'conference','automatic','conference',$3,$4::jsonb)",[randomUUID(),stableIdempotencyUuid(transaction.identity.accountId+":receiving-conference:"+conference["id"]+":"+JSON.stringify(conference)),conference["id"],JSON.stringify({operation:"upsert",conference})]);
      await releaseTransaction(client,true);transaction=null;return Response.json({ok:true,data:true});
    }
    if (action === "complete_action") {
      if (!receivingId) return Response.json({ ok: false, error: "Identificador de recebimento inválido." }, { status: 400 });
      transaction = await beginAuthenticatedTransaction(request);
      const client = transaction.client;
      const row = await client.query<{ state: Record<string, unknown> }>(
        "SELECT state FROM public.app_state WHERE owner_id=$1 FOR UPDATE",
        [transaction.identity.accountId],
      );
      const state = row.rows[0]?.state;
      if (!state || typeof state !== "object") {
        await releaseTransaction(client, false);
        transaction = null;
        return Response.json({ ok: true, data: false });
      }
      const receiving = Array.isArray(state["receiving"]) ? state["receiving"] as ReceivingNote[] : [];
      const note = receiving.find((item) => item.id === receivingId);
      const hasReturn = Object.values(note?.decisions ?? {}).includes("devolver");
      if (!note || note.stockReleased !== true || !hasReturn) {
        await releaseTransaction(client, false);
        transaction = null;
        return Response.json({ ok: true, data: false });
      }
      // Idempotent acknowledgement only: this action never changes stock or
      // creates stock movements. A retry after completion is a no-op success.
      if (note.actionCompleted === true) {
        await releaseTransaction(client, false);
        transaction = null;
        return Response.json({ ok: true, data: true });
      }
      const nextReceiving = receiving.map((item) =>
        item.id === receivingId ? { ...item, actionCompleted: true } : item,
      );
      const nextState = { ...state, receiving: nextReceiving };
      await client.query(
        "UPDATE public.app_state SET state=$2::jsonb,updated_at=now() WHERE owner_id=$1",
        [transaction.identity.accountId, JSON.stringify(nextState)],
      );
      await client.query(
        "SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'receiving','automatic','receiving',$3,$4::jsonb)",
        [
          randomUUID(),
          stableIdempotencyUuid(transaction.identity.accountId + ":receiving:" + receivingId + ":action-completed"),
          receivingId,
          JSON.stringify({ operation: "action_completed", actionCompleted: true }),
        ],
      );
      await releaseTransaction(client, true);
      transaction = null;
      return Response.json({ ok: true, data: true });
    }
    if (action === "save" || action === "delete") {
      transaction = await beginAuthenticatedTransaction(request);
      const client = transaction.client;
      const row = await client.query<{state:Record<string,unknown>}>("SELECT state FROM public.app_state WHERE owner_id=$1 FOR UPDATE",[transaction.identity.accountId]);
      const state = row.rows[0]?.state;
      if (!state || typeof state !== "object") { await releaseTransaction(client,false); transaction=null; return Response.json({ok:false,error:"Dados da empresa não encontrados."},{status:404}); }
      const current = Array.isArray(state["receiving"]) ? state["receiving"] as ReceivingNote[] : [];
      if (action === "delete") {
        if (!receivingId) { await releaseTransaction(client,false); transaction=null; return Response.json({ok:false,error:"Identificador inválido."},{status:400}); }
        const old = current.find((item)=>item.id===receivingId);
        if (!old || old.stockReleased) { await releaseTransaction(client,false); transaction=null; return Response.json({ok:false,error:"Recebimento não encontrado ou já liberado."},{status:409}); }
        const next = {...state,receiving:current.filter((item)=>item.id!==receivingId)};
        await client.query("UPDATE public.app_state SET state=$2::jsonb,updated_at=now() WHERE owner_id=$1",[transaction.identity.accountId,JSON.stringify(next)]);
        await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'receiving','automatic','receiving',$3,$4::jsonb)",[randomUUID(),stableIdempotencyUuid(transaction.identity.accountId+":receiving:"+receivingId+":delete"),receivingId,JSON.stringify({operation:"delete",privateDetailsAvailable:true})]);
        await releaseTransaction(client,true);transaction=null;return Response.json({ok:true,data:true});
      }
      const raw = body["note"] as ReceivingNote | undefined;
      if (!raw || typeof raw!=="object" || Array.isArray(raw) || typeof raw.id!=="string" || !raw.id || !Array.isArray(raw.items) || !["pendente","analisando","conferido","divergente","aceito","rejeitado"].includes(String(raw.status))) {
        await releaseTransaction(client,false);transaction=null;return Response.json({ok:false,error:"Dados do recebimento inválidos."},{status:400});
      }
      const old = current.find((item)=>item.id===raw.id);
      if (old?.stockReleased) { await releaseTransaction(client,false);transaction=null;return Response.json({ok:false,error:"Um recebimento já liberado não pode ser alterado."},{status:409}); }
      const productIds = new Set((Array.isArray(state["products"])?state["products"] as Array<Record<string,unknown>>:[]).map((item)=>String(item["id"]??"")));
      const lines = [...raw.items,...(Array.isArray((raw as any).extras)?(raw as any).extras:[])];
      if (!lines.length || lines.some((line:any)=>typeof line.productId!=="string"||!productIds.has(line.productId))) {
        await releaseTransaction(client,false);transaction=null;return Response.json({ok:false,error:"Os produtos do recebimento não pertencem a esta empresa."},{status:400});
      }
      const saved:ReceivingNote={...raw,stockReleased:false};
      const nextReceiving = old ? current.map((item)=>item.id===raw.id?saved:item) : [saved,...current];
      const nextState={...state,receiving:nextReceiving};
      const projection={...saved,supplierCnpj:undefined};
      const eventPayload=JSON.stringify({operation:"upsert",receiving:projection,privateDetailsAvailable:true});
      if(new TextEncoder().encode(eventPayload).byteLength>15000){await releaseTransaction(client,false);transaction=null;return Response.json({ok:false,error:"Recebimento excede o limite de sincronização."},{status:413});}
      await client.query("UPDATE public.app_state SET state=$2::jsonb,updated_at=now() WHERE owner_id=$1",[transaction.identity.accountId,JSON.stringify(nextState)]);
      await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'receiving','automatic','receiving',$3,$4::jsonb)",[randomUUID(),stableIdempotencyUuid(transaction.identity.accountId+":receiving:"+raw.id+":"+JSON.stringify(projection)),raw.id,eventPayload]);
      await releaseTransaction(client,true);transaction=null;return Response.json({ok:true,data:true});
    }
    if (!receivingId || !["accept", "finalize_decisions"].includes(action)) {
      return Response.json({ ok: false, error: "Solicitação de recebimento inválida." }, { status: 400 });
    }

    transaction = await beginAuthenticatedTransaction(request);
    const client = transaction.client;
    const result = await client.query<{ state: Record<string, unknown> }>(
      "SELECT state FROM public.app_state WHERE owner_id=$1 FOR UPDATE",
      [transaction.identity.accountId],
    );
    const state = result.rows[0]?.state;
    if (!state || typeof state !== "object") {
      await releaseTransaction(client, false);
      transaction = null;
      return Response.json({ ok: true, data: false });
    }

    const receiving = Array.isArray(state["receiving"]) ? state["receiving"] as ReceivingNote[] : [];
    const index = receiving.findIndex((note) => note.id === receivingId);
    const note = index >= 0 ? receiving[index] : null;
    const lines = note ? [...(note.items ?? []), ...(note.extras ?? [])] : [];
    const decisions = action === "finalize_decisions"
      ? (body["decisions"] && typeof body["decisions"] === "object" && !Array.isArray(body["decisions"])
        ? body["decisions"] as Record<string, string>
        : null)
      : (note?.decisions ?? null);

    const eligible = action === "accept"
      ? note?.status === "analisando" && note.decisionCompleted === true && note.stockReleased !== true
      : note?.status === "analisando" && note.stockReleased !== true;

    if (!note || !eligible || !lines.length || !decisions ||
      lines.some((line) => !line.productId || !["aceitar", "devolver"].includes(decisions[line.productId] ?? ""))) {
      await releaseTransaction(client, false);
      transaction = null;
      return Response.json({ ok: true, data: false });
    }

    const additions = new Map<string, number>();
    for (const line of lines) {
      const productId = line.productId!;
      const quantity = Number(line.received ?? 0);
      if (!Number.isFinite(quantity) || quantity < 0 || Math.round(quantity * 1000) !== quantity * 1000) {
        await releaseTransaction(client, false);
        transaction = null;
        return Response.json({ ok: false, data: false, error: "Quantidade recebida inválida." }, { status: 400 });
      }
      if (decisions[productId] !== "aceitar") continue;
      additions.set(productId, (additions.get(productId) ?? 0) + quantity);
    }

    const acceptedProductIds = [...additions.entries()].filter(([, quantity]) => quantity > 0).map(([id]) => id).sort();
    const relationalProducts = acceptedProductIds.length
      ? await client.query<{ id: string; code: string; name: string; unit: "un" | "kg"; cost: string; stock: string; active: boolean }>(
          `SELECT id, code, name, unit, cost::text, stock::text, active
           FROM public.products WHERE tenant_id = $1 AND id = ANY($2::text[])
           ORDER BY id FOR UPDATE`,
          [transaction.identity.accountId, acceptedProductIds],
        )
      : { rows: [] };
    if (relationalProducts.rows.length !== acceptedProductIds.length) {
      await releaseTransaction(client, false);
      transaction = null;
      return Response.json({ ok: false, data: false, error: "Um ou mais produtos aceitos não existem no estoque oficial desta empresa." }, { status: 409 });
    }

    const operator = transaction.identity.displayName || transaction.identity.username || "Gerência";
    const occurredAt = new Date().toISOString();
    const operationKey = `${transaction.identity.accountId}:receiving:${receivingId}:release`;
    const stockAfterByProduct = new Map<string, number>();
    const stockEvents: Array<{ productId: string; quantity: number; before: number; after: number; delta: number; code: string; name: string; unit: "un" | "kg"; totalValue: number }> = [];

    for (const product of relationalProducts.rows) {
      const quantity = additions.get(product.id) ?? 0;
      if (quantity <= 0) continue;
      if (product.unit === "un" && !Number.isInteger(quantity)) {
        await releaseTransaction(client, false);
        transaction = null;
        return Response.json({ ok: false, data: false, error: `A quantidade aceita de ${product.name} deve ser um número inteiro.` }, { status: 400 });
      }
      const before = Number(product.stock);
      if (!Number.isFinite(before) || before < 0) throw new Error("Estoque oficial inválido para concluir o recebimento.");
      const after = Math.round((before + quantity + Number.EPSILON) * 1000) / 1000;
      const totalValue = Math.round((quantity * Math.max(0, Number(product.cost)) + Number.EPSILON) * 100) / 100;
      const update = await client.query(
        `UPDATE public.products SET stock = $3, version = version + 1, updated_at = now()
         WHERE tenant_id = $1 AND id = $2 AND stock = $4`,
        [transaction.identity.accountId, product.id, after, product.stock],
      );
      if (update.rowCount !== 1) throw new Error("Estoque alterado por outra operação. Atualize e tente novamente.");

      const movementId = `${receivingId}:${product.id}`;
      const idempotencyKey = stableIdempotencyUuid(`${operationKey}:stock:${product.id}`);
      const details = `Nota ${String(note["number"] ?? receivingId)} · ${String(note["supplier"] ?? "Fornecedor")}`;
      await client.query(
        `INSERT INTO public.stock_movements (
          tenant_id, id, operation_id, operation_type, line_key, product_id,
          product_code, product_name, unit, quantity, total_value,
          stock_before, stock_after, delta, operator_profile_id,
          operator_snapshot, details, occurred_at, idempotency_key
        ) VALUES ($1, $2, $3, 'receiving', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          transaction.identity.accountId, movementId, receivingId, product.id, product.id,
          product.code, product.name, product.unit, quantity, totalValue,
          before, after, quantity, transaction.identity.userId, operator,
          details, occurredAt, idempotencyKey,
        ],
      );
      stockAfterByProduct.set(product.id, after);
      stockEvents.push({ productId: product.id, quantity, before, after, delta: quantity, code: product.code, name: product.name, unit: product.unit, totalValue });
    }

    const products = Array.isArray(state["products"]) ? state["products"] as Array<Record<string, unknown>> : [];
    const nextProducts = products.map((product) => {
      const stockAfter = stockAfterByProduct.get(String(product["id"] ?? ""));
      return stockAfter === undefined ? product : { ...product, stock: stockAfter };
    });

    const nextReceiving = receiving.map((current, currentIndex) => {
      if (currentIndex !== index) return current;
      if (action === "finalize_decisions") {
        return { ...current, decisions, decisionCompleted: true, status: "aceito", stockReleased: true };
      }
      return { ...current, status: "aceito", stockReleased: true };
    });

    const nextState = { ...state, products: nextProducts, receiving: nextReceiving };

    // Append the manual receiving event and each actual stock delta in this
    // same transaction as the app_state mutation. Deterministic idempotency
    // keys protect retries; stockReleased prevents a second stock release.
    const acceptedLineCount = lines.filter((line) => decisions[line.productId!] === "aceitar" && Number(line.received ?? 0) > 0).length;
    const returnedLineCount = lines.filter((line) => decisions[line.productId!] === "devolver").length;

    const receivingEventPayload = {
      status: "aceito",
      decisionCompleted: true,
      acceptedLineCount,
      returnedLineCount,
      lines: lines.map((line) => ({
        productId: line.productId,
        received: Number(line.received ?? 0),
        decision: decisions[line.productId!],
      })),
    };
    const serializedReceivingEvent = JSON.stringify(receivingEventPayload);
    if (new TextEncoder().encode(serializedReceivingEvent).byteLength > 15_000) {
      await releaseTransaction(client, false);
      transaction = null;
      return Response.json(
        { ok: false, error: "O recebimento contém dados demais para sincronização segura.", code: "receiving_event_too_large" },
        { status: 413 },
      );
    }
    await client.query(
      `SELECT public.mobflow_append_sync_event(
        $1::uuid, $2::uuid, 'receiving', 'automatic', 'receiving', $3, $4::jsonb
      )`,
      [
        randomUUID(),
        stableIdempotencyUuid(`${operationKey}:manual`),
        receivingId,
        serializedReceivingEvent,
      ],
    );

    for (const movement of stockEvents) {
      await client.query(
        `SELECT public.mobflow_append_sync_event(
          $1::uuid, $2::uuid, 'stock', 'automatic', 'product', $3, $4::jsonb
        )`,
        [
          randomUUID(),
          stableIdempotencyUuid(`${operationKey}:stock-event:${movement.productId}`),
          movement.productId,
          JSON.stringify({
            operationId: receivingId, operationType: "receiving",
            delta: movement.delta, stockDelta: movement.delta,
            stockBefore: movement.before, stockAfter: movement.after,
            quantity: movement.quantity, productCode: movement.code,
            productName: movement.name, unit: movement.unit,
            totalValue: movement.totalValue,
            reason: `Nota ${String(note["number"] ?? receivingId)} · ${String(note["supplier"] ?? "Fornecedor")}`,
            operator, occurredAt, source: "receiving",
          }),
        ],
      );
    }

    await client.query(
      "UPDATE public.app_state SET state=$2::jsonb,updated_at=now() WHERE owner_id=$1",
      [transaction.identity.accountId, JSON.stringify(nextState)],
    );
    await releaseTransaction(client, true);
    transaction = null;
    return Response.json({ ok: true, data: true });
  } catch (error) {
    if (transaction) await releaseTransaction(transaction.client, false).catch(() => undefined);
    return jsonError(error);
  }
}

export const Route = createFileRoute("/api/mobflow/receiving")({
  server: { handlers: { POST: ({ request }) => handleMobFlowReceiving(request) } },
});
