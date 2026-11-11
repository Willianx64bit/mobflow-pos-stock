import { createHash, randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { beginAuthenticatedTransaction, jsonError, ApiAuthError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

type PaymentMethod = "cash" | "pix" | "card";
class ReceivableError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "invalid_receivable") { super(message); }
}
const fail = (message: string, status = 400, code = "invalid_receivable"): never => { throw new ReceivableError(message, status, code); };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const text = (value: unknown, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
function stableUuid(value: string) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 15) | 0x50; bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function respondError(error: unknown) {
  if (error instanceof ReceivableError) return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  if (error instanceof ApiAuthError) return jsonError(error);
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code === "23505") return Response.json({ ok: false, error: "Este recebimento já foi registrado.", code: "duplicate_receivable" }, { status: 409 });
  if (code === "23503" || code === "23514") return Response.json({ ok: false, error: "O recebimento não atende às regras do banco.", code: "receivable_constraint" }, { status: 409 });
  return jsonError(error);
}
export async function handleMobFlowReceivable(request: Request) {
  if (process.env["MOBFLOW_AUTH_PROVIDER"] !== "better-auth") return Response.json({ ok: false, error: "Recebimentos Fiado Neon não habilitados neste ambiente.", code: "receivables_provider_disabled" }, { status: 503 });
  let tx: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") fail("Solicitação de recebimento inválida.");
    const input = body as Record<string, unknown>;
    const saleId = text(input["saleId"], 100), idempotencyKey = input["idempotencyKey"];
    const amount = Number(input["amount"]), method = input["paymentMethod"] as PaymentMethod;
    if (!saleId || !uuid(idempotencyKey)) fail("Identificadores do recebimento inválidos.");
    if (!Number.isFinite(amount) || amount <= 0 || !["cash", "pix", "card"].includes(String(method))) fail("Valor ou forma de pagamento inválidos.");

    tx = await beginAuthenticatedTransaction(request);
    const { client, identity } = tx;
    if (!(identity.role === "manager" || (identity.role === "pdv" && Array.isArray(identity.permissions) && identity.permissions.includes("PDV")))) fail("Usuário sem permissão para receber Fiado.", 403, "permission_denied");

    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [identity.accountId + ":receivable:" + idempotencyKey]);
    const prior = await client.query("SELECT id,sale_id,amount::text,payment_method FROM public.receivable_payments WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE", [identity.accountId, idempotencyKey]);
    if (prior.rows.length) {
      const row = prior.rows[0];
      if (row.sale_id !== saleId || Math.abs(Number(row.amount) - money(amount)) > 0.005 || row.payment_method !== method) fail("Chave de idempotência reutilizada com outro recebimento.", 409, "idempotency_conflict");
      await releaseTransaction(client, true); tx = null;
      return Response.json({ ok: true, replayed: true, payment: { id: row.id, saleId, amount: Number(row.amount), paymentMethod: row.payment_method } });
    }

    const saleResult = await client.query(
      "SELECT id, cash_session_id, seller_snapshot, customer_name_snapshot, customer_document_snapshot, status, payment_status, paid_at, payment_method, occurred_at, subtotal::text, discount_amount::text, discount_type, total::text, cost_total::text, profit_total::text, hidden_from_fiado FROM public.sales WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [identity.accountId, saleId],
    );
    const sale = saleResult.rows[0];
    if (!sale || sale.payment_method !== "fiado" || sale.status !== "completed") fail("Venda Fiado não encontrada ou indisponível.", 404, "fiado_sale_not_found");

    const paidResult = await client.query("SELECT COALESCE(SUM(amount),0)::text AS paid FROM public.receivable_payments WHERE tenant_id=$1 AND sale_id=$2", [identity.accountId, saleId]);
    const paidBefore = money(Number(paidResult.rows[0]?.paid ?? 0));
    const total = money(Number(sale.total));
    const remaining = money(total - paidBefore);
    const received = money(amount);
    if (received <= 0) fail("Informe um valor de recebimento válido.");
    if (remaining <= 0.005) fail("Esta venda Fiado já está quitada.", 409, "receivable_already_paid");
    if (received > remaining + 0.005) fail("O recebimento não pode ultrapassar o saldo restante.", 409, "receivable_exceeds_balance");

    const now = new Date().toISOString();
    const paymentId = saleId + ":receivable:" + idempotencyKey;
    await client.query(
      "INSERT INTO public.receivable_payments(tenant_id,id,sale_id,amount,payment_method,operator_profile_id,operator_snapshot,occurred_at,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [identity.accountId, paymentId, saleId, received, method, identity.userId, identity.displayName || identity.username, now, idempotencyKey],
    );
    await client.query(
      "INSERT INTO public.sale_payments(tenant_id,id,sale_id,method,amount,received_amount,change_amount,occurred_at,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,0,$7,$8)",
      [identity.accountId, paymentId, saleId, method, received, received, now, stableUuid(identity.accountId + ":receivable-sale-payment:" + idempotencyKey)],
    );

    const paidAfter = money(paidBefore + received);
    const isPaid = paidAfter >= total - 0.005;
    const profit = isPaid ? money(total - Number(sale.cost_total)) : 0;
    await client.query(
      "UPDATE public.sales SET payment_status=$3,paid_at=$4,profit_total=$5 WHERE tenant_id=$1 AND id=$2",
      [identity.accountId, saleId, isPaid ? "paid" : "partial", isPaid ? now : null, profit],
    );

    const itemsResult = await client.query("SELECT product_id,product_name_snapshot,unit_price::text,unit_cost::text,quantity::text,unit FROM public.sale_items WHERE tenant_id=$1 AND sale_id=$2 ORDER BY line_key", [identity.accountId, saleId]);
    const paymentsResult = await client.query("SELECT amount::text,occurred_at FROM public.receivable_payments WHERE tenant_id=$1 AND sale_id=$2 ORDER BY occurred_at,id", [identity.accountId, saleId]);
    const saleProjection = {
      id: saleId, date: sale.occurred_at, cashSessionId: sale.cash_session_id,
      items: itemsResult.rows.map((item: any) => ({ productId: item.product_id, name: item.product_name_snapshot, price: Number(item.unit_price), cost: Number(item.unit_cost), qty: Number(item.quantity), unit: item.unit })),
      total, subtotal: Number(sale.subtotal), discount: Number(sale.discount_amount),
      discountType: sale.discount_type === "percentage" ? "%" : "R$",
      payment: "Fiado", received: 0, customer: sale.customer_name_snapshot ?? undefined,
      cpf: sale.customer_document_snapshot ?? undefined, seller: sale.seller_snapshot,
      paid: isPaid, paidAt: isPaid ? now : undefined, profit,
      hiddenFromFiado: sale.hidden_from_fiado,
      payments: paymentsResult.rows.map((item: any) => ({ value: Number(item.amount), date: item.occurred_at })),
    };
    await client.query(
      "SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'sales','automatic','sale',$3,$4::jsonb)",
      [randomUUID(), stableUuid(identity.accountId + ":receivable-event:" + idempotencyKey), saleId, JSON.stringify({ sale: saleProjection, saleId, paymentStatus: isPaid ? "paid" : "partial", paidTotal: paidAfter })],
    );

    await releaseTransaction(client, true); tx = null;
    return Response.json({ ok: true, replayed: false, payment: { id: paymentId, saleId, amount: received, paymentMethod: method, paidTotal: paidAfter, remaining: money(total - paidAfter), paid: isPaid } }, { status: 201 });
  } catch (error) {
    if (tx) await releaseTransaction(tx.client, false).catch(() => undefined);
    return respondError(error);
  }
}
export const Route = createFileRoute("/api/mobflow/receivables")({ server: { handlers: { POST: ({ request }) => handleMobFlowReceivable(request) } } });
