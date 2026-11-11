import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { client, beginAuthenticatedTransaction, releaseTransaction } = vi.hoisted(() => {
  const query = vi.fn();
  const client = { query, release: vi.fn() };
  return { client, beginAuthenticatedTransaction: vi.fn(), releaseTransaction: vi.fn(async () => undefined) };
});
vi.mock("@/lib/server/mobflow-auth", () => ({
  beginAuthenticatedTransaction,
  jsonError: (error: unknown) => Response.json({ ok: false, error: String(error) }, { status: 500 }),
}));
vi.mock("@/lib/server/neon", () => ({ releaseTransaction }));
import { handleMobFlowReceivable } from "@/routes/api/mobflow/receivables";

const USER = "6c47eaac-2abf-4cd6-b614-24e27077bdf6";
const ACCOUNT = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const KEY = "7c47eaac-2abf-4cd6-b614-24e27077bdf6";
const body = () => ({ saleId: "sale-fiado-1", amount: 20, paymentMethod: "cash", idempotencyKey: KEY });
const request = (input = body()) => new Request("https://mobflow.test/api/mobflow/receivables", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
});

describe("Neon Fiado receivable payments", () => {
  const previousProvider = process.env["MOBFLOW_AUTH_PROVIDER"];
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["MOBFLOW_AUTH_PROVIDER"] = "better-auth";
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.receivable_payments WHERE tenant_id=$1 AND idempotency_key")) return { rows: [] };
      if (sql.includes("FROM public.sales WHERE tenant_id=$1 AND id=$2 FOR UPDATE")) return { rows: [{
        id: "sale-fiado-1", cash_session_id: "cash-1", seller_snapshot: "Operador",
        customer_name_snapshot: "Maria", customer_document_snapshot: null, status: "completed",
        payment_status: "unpaid", paid_at: null, payment_method: "fiado",
        occurred_at: "2026-11-10T10:00:00.000Z", subtotal: "50", discount_amount: "0",
        discount_type: "fixed", total: "50", cost_total: "20", profit_total: "0", hidden_from_fiado: false,
      }] };
      if (sql.includes("COALESCE(SUM(amount),0)")) return { rows: [{ paid: "0" }] };
      if (sql.includes("SELECT product_id,product_name_snapshot")) return { rows: [{ product_id: "p1", product_name_snapshot: "Arroz", unit_price: "50", unit_cost: "20", quantity: "1", unit: "un" }] };
      if (sql.includes("SELECT amount::text,occurred_at FROM public.receivable_payments")) return { rows: [{ amount: "20", occurred_at: "2026-11-10T10:05:00.000Z" }] };
      return { rows: [] };
    });
    beginAuthenticatedTransaction.mockResolvedValue({
      client,
      identity: { userId: USER, accountId: ACCOUNT, role: "pdv", username: "op", displayName: "Operador", permissions: ["PDV"] },
    });
  });
  afterEach(() => {
    if (previousProvider === undefined) delete process.env["MOBFLOW_AUTH_PROVIDER"];
    else process.env["MOBFLOW_AUTH_PROVIDER"] = previousProvider;
  });

  it("records a partial payment, a cash ledger payment and an updated sale event atomically", async () => {
    const response = await handleMobFlowReceivable(request());
    const result = await response.json();
    expect(response.status).toBe(201);
    expect(result.payment).toMatchObject({ saleId: "sale-fiado-1", amount: 20, remaining: 30, paid: false });
    const queries = client.query.mock.calls.map((call) => String(call[0]));
    expect(queries.some((sql) => sql.includes("INSERT INTO public.receivable_payments"))).toBe(true);
    expect(queries.some((sql) => sql.includes("INSERT INTO public.sale_payments"))).toBe(true);
    expect(queries.some((sql) => sql.includes("UPDATE public.sales SET payment_status"))).toBe(true);
    const event = client.query.mock.calls.find((call) => String(call[0]).includes("'sales','automatic','sale'"));
    expect(event).toBeTruthy();
    expect(String(event?.[1]?.[3])).toContain('"payment":"Fiado"');
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("rejects a payment larger than the remaining balance without writing", async () => {
    const response = await handleMobFlowReceivable(request({ ...body(), amount: 60 }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("receivable_exceeds_balance");
    expect(client.query.mock.calls.some((call) => String(call[0]).includes("INSERT INTO public.receivable_payments"))).toBe(false);
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });
});
