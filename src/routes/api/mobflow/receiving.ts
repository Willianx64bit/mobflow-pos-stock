import { createHash, randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

type ReceiveLine = { productId?: string; received?: number };
function stableIdempotencyUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
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
  if (process.env.MOBFLOW_AUTH_PROVIDER !== "better-auth") {
    return Response.json({ ok: false, error: "Este fluxo ainda não está ativo neste ambiente." }, { status: 503 });
  }

  let transaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const receivingId = String(body.receivingId ?? "");
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

    const receiving = Array.isArray(state.receiving) ? state.receiving as ReceivingNote[] : [];
    const index = receiving.findIndex((note) => note.id === receivingId);
    const note = index >= 0 ? receiving[index] : null;
    const lines = note ? [...(note.items ?? []), ...(note.extras ?? [])] : [];
    const decisions = action === "finalize_decisions"
      ? (body.decisions && typeof body.decisions === "object" && !Array.isArray(body.decisions)
        ? body.decisions as Record<string, string>
        : null)
      : (note?.decisions ?? null);

    const eligible = action === "accept"
      ? note?.status === "analisando" && note.decisionCompleted === true && note.stockReleased !== true
      : note?.status === "analisando" && note.stockReleased !== true;

    if (!note || !eligible || !lines.length || !decisions ||
      lines.some((line) => !line.productId || !["aceitar", "devolver"].includes(decisions[line.productId]))) {
      await releaseTransaction(client, false);
      transaction = null;
      return Response.json({ ok: true, data: false });
    }

    const products = Array.isArray(state.products) ? state.products as Array<Record<string, unknown>> : [];
    const additions = new Map<string, number>();
    for (const line of lines) {
      if (decisions[line.productId!] !== "aceitar") continue;
      const quantity = Number(line.received ?? 0);
      if (!Number.isFinite(quantity) || quantity < 0) {
        await releaseTransaction(client, false);
        transaction = null;
        return Response.json({ ok: true, data: false });
      }
      additions.set(line.productId!, (additions.get(line.productId!) ?? 0) + quantity);
    }

    const productIds = new Set(products.map((product) => String(product.id ?? "")));
    if ([...additions.keys()].some((id) => !productIds.has(id))) {
      await releaseTransaction(client, false);
      transaction = null;
      return Response.json({ ok: true, data: false });
    }

    const nextProducts = products.map((product) => {
      const id = String(product.id ?? "");
      const amount = additions.get(id) ?? 0;
      if (!amount) return product;
      return { ...product, stock: Number(product.stock ?? 0) + amount };
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
    const operationKey = `${transaction.identity.accountId}:receiving:${receivingId}:release`;
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
        $1::uuid, $2::uuid, 'receiving', 'manual', 'receiving', $3, $4::jsonb
      )`,
      [
        randomUUID(),
        stableIdempotencyUuid(`${operationKey}:manual`),
        receivingId,
        serializedReceivingEvent,
      ],
    );

    for (const [productId, delta] of additions) {
      if (delta <= 0) continue;
      await client.query(
        `SELECT public.mobflow_append_sync_event(
          $1::uuid, $2::uuid, 'stock', 'automatic', 'product', $3, $4::jsonb
        )`,
        [
          randomUUID(),
          stableIdempotencyUuid(`${operationKey}:stock:${productId}`),
          productId,
          JSON.stringify({ stockDelta: delta, source: "receiving" }),
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
