import { createHash, randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { beginAuthenticatedTransaction, jsonError, ApiAuthError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

type Unit = "un" | "kg";
type PaymentMethod = "cash" | "pix" | "card" | "fiado";
type SaleInput = {
  saleId?: unknown;
  idempotencyKey?: unknown;
  cashSessionId?: unknown;
  paymentMethod?: unknown;
  receivedAmount?: unknown;
  discountAmount?: unknown;
  discountType?: unknown;
  customerName?: unknown;
  customerDocument?: unknown;
  items?: unknown;
};
type CartLine = { productId: string; quantity: number; lineKey: string };
class SaleCommandError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "invalid_sale") { super(message); }
}
const fail = (message: string, status = 400, code = "invalid_sale"): never => { throw new SaleCommandError(message, status, code); };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const text = (v: unknown, max = 160) => typeof v === "string" ? v.trim().slice(0, max) : "";
const money = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const quantity3 = (v: number) => Math.round((v + Number.EPSILON) * 1000) / 1000;
function stableUuid(value: string) {
  const b = createHash("sha256").update(value).digest().subarray(0, 16);
  b[6] = (b[6] & 15) | 0x50; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function errorResponse(error: unknown) {
  if (error instanceof SaleCommandError) return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  if (error instanceof ApiAuthError) return jsonError(error);
  const code = typeof error === "object" && error && "code" in error ? String((error as {code:unknown}).code) : "";
  if (code === "23505") return Response.json({ ok: false, error: "Esta operação já foi registrada.", code: "duplicate_operation" }, { status: 409 });
  if (code === "23503" || code === "23514") return Response.json({ ok: false, error: "Os dados da venda não atendem às regras do banco.", code: "sale_constraint" }, { status: 409 });
  return jsonError(error);
}
async function ready(client: any) {
  const r = await client.query("SELECT to_regclass('public.sales')::text AS sales,to_regclass('public.sale_items')::text AS items,to_regclass('public.sale_payments')::text AS payments,to_regclass('public.receivable_payments')::text AS receivables,to_regclass('public.stock_movements')::text AS stock,to_regclass('public.mobflow_sync_events')::text AS events,to_regprocedure('public.mobflow_append_sync_event(uuid,uuid,text,text,text,text,jsonb)')::text AS append_fn");
  if (Object.values(r.rows[0] ?? {}).some((v) => !v)) fail("A estrutura relacional de vendas ainda não está pronta.", 503, "sales_schema_not_ready");
}
export async function handleMobFlowSale(request: Request) {
  if (process.env["MOBFLOW_AUTH_PROVIDER"] !== "better-auth") return Response.json({ ok: false, error: "Vendas Neon ainda não estão habilitadas neste ambiente.", code: "sales_provider_disabled" }, { status: 503 });
  let tx: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
  try {
    const body = await request.json().catch(() => null) as SaleInput | null;
    if (!body || typeof body !== "object") return Response.json({ ok: false, error: "Solicitação de venda inválida.", code: "invalid_sale" }, { status: 400 });
    const saleId = text(body.saleId, 100), cashSessionId = text(body.cashSessionId, 100);
    if (!saleId || !cashSessionId || !uuid(body.idempotencyKey)) fail("Identificadores da venda inválidos.");
    const paymentMethod = body.paymentMethod;
    if (!["cash", "pix", "card", "fiado"].includes(String(paymentMethod))) fail("Forma de pagamento inválida.");
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 200) fail("Itens da venda inválidos.");
    const discountAmountInput = body.discountAmount === undefined ? 0 : Number(body.discountAmount);
    if (!Number.isFinite(discountAmountInput) || discountAmountInput < 0 || !["fixed", "percentage", undefined].includes(body.discountType as any) || (body.discountType === "percentage" && discountAmountInput > 100)) fail("Desconto inválido.");
    const customerName = text(body.customerName, 160) || null;
    const customerDocument = text(body.customerDocument, 32) || null;

    tx = await beginAuthenticatedTransaction(request);
    const { client, identity } = tx;
    if (!(identity.role === "manager" || (identity.role === "pdv" && Array.isArray(identity.permissions) && identity.permissions.includes("PDV")))) fail("Usuário sem permissão para realizar vendas.", 403, "permission_denied");
    await ready(client);

    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [identity.accountId + ":sale-idempotency:" + body.idempotencyKey]);
    const replay = await client.query("SELECT id,total::text,subtotal::text,discount_amount::text,discount_type,payment_method,payment_status,cash_session_id,customer_name_snapshot,customer_document_snapshot,occurred_at FROM public.sales WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE", [identity.accountId, body.idempotencyKey]);
    if (replay.rows.length) {
      const existing = replay.rows[0];
      if (existing.id !== saleId || existing.cash_session_id !== cashSessionId || existing.payment_method !== paymentMethod || existing.customer_name_snapshot !== customerName || existing.customer_document_snapshot !== customerDocument) fail("Chave de idempotência reutilizada com outra venda.", 409, "idempotency_conflict");
      const items = await client.query("SELECT product_id,quantity::text FROM public.sale_items WHERE tenant_id=$1 AND sale_id=$2 ORDER BY product_id", [identity.accountId, saleId]);
      const requested = new Map<string, number>();
      for (const raw of body.items as Array<Record<string, unknown>>) {
        const productId = text(raw?.["productId"], 100), quantity = Number(raw?.["quantity"]);
        if (!productId || !Number.isFinite(quantity) || quantity <= 0) fail("Itens inválidos na repetição da venda.");
        requested.set(productId, quantity3((requested.get(productId) ?? 0) + quantity));
      }
      const stored = items.rows.map((row: any) => [row.product_id, Number(row.quantity)] as [string, number]);
      const sameItems = stored.length === requested.size && stored.every(([productId, quantity]) => requested.has(productId) && Math.abs(requested.get(productId)! - quantity) < 0.0005);
      const requestedDiscountAmount = Number(body.discountAmount ?? 0);
      const requestedDiscount = body.discountType === "percentage"
        ? money(Number(existing.subtotal) * Math.min(requestedDiscountAmount, 100) / 100)
        : money(Math.min(Number(existing.subtotal), requestedDiscountAmount));
      const payments = await client.query("SELECT received_amount::text FROM public.sale_payments WHERE tenant_id=$1 AND sale_id=$2 ORDER BY occurred_at", [identity.accountId, saleId]);
      const requestedReceived = paymentMethod === "fiado" ? 0 : Number(body.receivedAmount ?? Number(existing.total));
      if (!sameItems || Math.abs(Number(existing.discount_amount) - requestedDiscount) > 0.005 ||
        existing.discount_type !== (body.discountType ?? "fixed") || payments.rows.length !== 1 ||
        Math.abs(Number(payments.rows[0].received_amount) - requestedReceived) > 0.005) {
        fail("A chave de idempotência foi reutilizada com conteúdo diferente.", 409, "idempotency_conflict");
      }
      await releaseTransaction(client, true); tx = null;
      return Response.json({ ok: true, replayed: true, sale: { id: existing.id, total: Number(existing.total), paymentMethod: existing.payment_method, paymentStatus: existing.payment_status, items: items.rows } });
    }

    const sessionResult = await client.query("SELECT id,status,operator_profile_id,operator_snapshot,opening_amount FROM public.cash_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [identity.accountId, cashSessionId]);
    const session = sessionResult.rows[0];
    if (!session || session.status !== "open" || session.operator_profile_id !== identity.userId) fail("Abra um caixa próprio antes de registrar a venda.", 409, "cash_session_not_open");

    const quantities = new Map<string, number>();
    for (let index = 0; index < body.items.length; index++) {
      const item = body.items[index] as Record<string, unknown>;
      const productId = text(item?.["productId"], 100), quantity = Number(item?.["quantity"]);
      if (!productId || !Number.isFinite(quantity) || quantity <= 0 || Math.round(quantity * 1000) !== quantity * 1000) fail("Produto ou quantidade inválida.");
      quantities.set(productId, quantity3((quantities.get(productId) ?? 0) + quantity));
    }
    const ids = [...quantities.keys()].sort();
    const productResult = await client.query("SELECT id,code,name,unit,price::text,cost::text,stock::text,active FROM public.products WHERE tenant_id=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE", [identity.accountId, ids]);
    if (productResult.rows.length !== ids.length) fail("Um ou mais produtos não existem nesta empresa.", 404, "product_not_found");
    const products = new Map<string, any>(productResult.rows.map((p: any) => [p.id, p]));
    const lines = ids.map((id, index) => {
      const p = products.get(id), quantity = quantities.get(id)!;
      const unit = p.unit as Unit;
      if (!p.active) fail("Um produto da venda está inativo.", 409, "product_inactive");
      if (unit === "un" && !Number.isInteger(quantity)) fail("Quantidade fracionada não permitida para produto por unidade.");
      const stock = Number(p.stock), price = Number(p.price), cost = Number(p.cost);
      if (!Number.isFinite(stock) || stock < quantity) fail("Estoque insuficiente para " + p.name + ".", 409, "insufficient_stock");
      return { product: p, quantity, unit, price, cost, lineTotal: money(price * quantity), lineCost: money(cost * quantity), lineKey: String(index + 1) };
    });
    const subtotal = money(lines.reduce((sum, l) => sum + l.lineTotal, 0));
    const discount = body.discountType === "percentage"
      ? money(subtotal * Math.min(discountAmountInput, 100) / 100)
      : money(Math.min(discountAmountInput, subtotal));
    if (body.discountType === "percentage" && discountAmountInput > 100) fail("Desconto percentual não pode ultrapassar 100%.");
    const total = money(Math.max(0, subtotal - discount));
    const costTotal = money(lines.reduce((sum, l) => sum + l.lineCost, 0));
    const received = body.receivedAmount === undefined ? total : Number(body.receivedAmount);
    if (!Number.isFinite(received) || received < 0) fail("Valor recebido inválido.");
    if (paymentMethod !== "fiado" && received < total) fail("Valor recebido insuficiente.");
    if (paymentMethod === "fiado" && received !== 0) fail("Venda fiada não pode receber pagamento inicial neste comando.");
    const change = paymentMethod === "cash" ? money(Math.max(0, received - total)) : 0;
    const now = new Date();
    const paid = paymentMethod !== "fiado";
    await client.query("INSERT INTO public.sales(tenant_id,id,cash_session_id,seller_profile_id,seller_snapshot,customer_name_snapshot,customer_document_snapshot,status,payment_status,paid_at,payment_method,occurred_at,subtotal,discount_amount,discount_type,total,cost_total,profit_total,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,'completed',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)", [
      identity.accountId, saleId, cashSessionId, identity.userId, identity.displayName || identity.username, customerName, customerDocument, paid ? "paid" : "unpaid", paid ? now.toISOString() : null, paymentMethod, now.toISOString(), subtotal, discount, body.discountType ?? "fixed", total, costTotal, paid ? money(total - costTotal) : 0, body.idempotencyKey,
    ]);

    for (const line of lines) {
      const p = line.product;
      await client.query("INSERT INTO public.sale_items(tenant_id,id,sale_id,product_id,product_code_snapshot,product_name_snapshot,unit,quantity,unit_price,unit_cost,line_discount,line_total,line_cost,line_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,$13)", [
        identity.accountId, saleId + ":" + p.id, saleId, p.id, p.code, p.name, line.unit, line.quantity, line.price, line.cost, line.lineTotal, line.lineCost, line.lineKey,
      ]);
      const stockAfter = quantity3(Number(p.stock) - line.quantity);
      const movementId = saleId + ":" + p.id;
      const stockUpdate = await client.query("UPDATE public.products SET stock=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND stock >= $4", [identity.accountId, p.id, stockAfter, line.quantity]);
      if (stockUpdate.rowCount !== 1) fail("Estoque alterado por outra operação. Atualize e tente novamente.", 409, "stock_conflict");
      await client.query("INSERT INTO public.stock_movements(tenant_id,id,operation_id,operation_type,line_key,product_id,product_code,product_name,unit,quantity,total_value,stock_before,stock_after,delta,operator_profile_id,operator_snapshot,details,occurred_at,idempotency_key) VALUES($1,$2,$3,'sale',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)", [
        identity.accountId, movementId, saleId, line.lineKey, p.id, p.code, p.name, line.unit, line.quantity, line.lineTotal, Number(p.stock), stockAfter, -line.quantity, identity.userId, identity.displayName || identity.username, "Venda " + saleId, now.toISOString(), stableUuid(identity.accountId + ":sale:" + saleId + ":stock:" + p.id),
      ]);
      await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'stock','automatic','product',$3,$4::jsonb)", [
        randomUUID(), stableUuid(identity.accountId + ":sale:" + saleId + ":stock-event:" + p.id), p.id, JSON.stringify({ stockDelta: -line.quantity, resultingStock: stockAfter, source: "sale", saleId, operationId: saleId, quantity: line.quantity, stockBefore: Number(p.stock), stockAfter, productCode: text(p.code, 80), productName: text(p.name, 160), unit: line.unit, totalValue: line.lineTotal, operator: identity.displayName || identity.username, occurredAt: now.toISOString() }),
      ]);
    }

    const paymentId = saleId + ":payment";
    await client.query("INSERT INTO public.sale_payments(tenant_id,id,sale_id,method,amount,received_amount,change_amount,occurred_at,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [
      identity.accountId, paymentId, saleId, paymentMethod, paid ? total : 0, paid ? received : 0, change, now.toISOString(), stableUuid(identity.accountId + ":sale:" + saleId + ":payment"),
    ]);
    await client.query("SELECT public.mobflow_append_sync_event($1::uuid,$2::uuid,'sales','automatic','sale',$3,$4::jsonb)", [
      randomUUID(), stableUuid(identity.accountId + ":sale:" + saleId + ":event"), saleId, JSON.stringify({ sale: { id: saleId, date: now.toISOString(), cashSessionId, seller: identity.displayName || identity.username, total, subtotal, discount, discountType: body.discountType === "percentage" ? "%" : "R$", profit: paid ? money(total - costTotal) : 0, payment: paymentMethod === "cash" ? "Dinheiro" : paymentMethod === "pix" ? "Pix" : paymentMethod === "card" ? "Cartão" : "Fiado", received, customer: customerName ?? undefined, paid, paidAt: paid ? now.toISOString() : undefined, items: lines.map((l) => ({ productId: l.product.id, name: text(l.product.name, 160), price: l.price, cost: l.cost, qty: l.quantity, unit: l.unit })) }, saleId, cashSessionId, total, paymentMethod, paymentStatus: paid ? "paid" : "unpaid" }),
    ]);
    await releaseTransaction(client, true); tx = null;
    return Response.json({ ok: true, replayed: false, sale: { id: saleId, total, subtotal, discount, paymentMethod, paymentStatus: paid ? "paid" : "unpaid", change, items: lines.map((l) => ({ productId: l.product.id, code: l.product.code, name: l.product.name, quantity: l.quantity, unitPrice: l.price, total: l.lineTotal })) } }, { status: 201 });
  } catch (error) {
    if (tx) await releaseTransaction(tx.client, false).catch(() => undefined);
    return errorResponse(error);
  }
}
export const Route = createFileRoute("/api/mobflow/sales")({ server: { handlers: { POST: ({ request }) => handleMobFlowSale(request) } } });
