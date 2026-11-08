import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { client, beginAuthenticatedTransaction, releaseTransaction } = vi.hoisted(() => {
  const query = vi.fn();
  const client = { query, release: vi.fn() };
  return {
    client,
    beginAuthenticatedTransaction: vi.fn(),
    releaseTransaction: vi.fn(async (_client: unknown, _commit: boolean) => undefined),
  };
});
vi.mock("@/lib/server/mobflow-auth", () => ({
  beginAuthenticatedTransaction,
  jsonError: (error: unknown) => Response.json({ ok: false, error: String(error) }, { status: 500 }),
}));
vi.mock("@/lib/server/neon", () => ({ releaseTransaction }));
import { handleMobFlowSale } from "@/routes/api/mobflow/sales";

const ACCOUNT = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const USER = "6c47eaac-2abf-4cd6-b614-24e27077bdf6";
const KEY = "7c47eaac-2abf-4cd6-b614-24e27077bdf6";
const payload = () => ({
  saleId: "sale-100",
  idempotencyKey: KEY,
  cashSessionId: "cash-1",
  paymentMethod: "cash",
  receivedAmount: 25,
  discountAmount: 0,
  items: [{ productId: "product-1", quantity: 2 }],
});
function request(body = payload()) {
  return new Request("https://mobflow.test/api/mobflow/sales", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
describe("Neon atomic sale command", () => {
  const previousProvider = process.env.MOBFLOW_AUTH_PROVIDER;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MOBFLOW_AUTH_PROVIDER = "better-auth";
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("to_regclass")) return { rows: [{ sales: "sales", items: "sale_items", payments: "sale_payments", stock: "stock_movements", events: "mobflow_sync_events", append_fn: "mobflow_append_sync_event" }] };
      if (sql.includes("FROM public.sales WHERE")) return { rows: [] };
      if (sql.includes("FROM public.cash_sessions")) return { rows: [{ id: "cash-1", status: "open", operator_profile_id: USER, operator_snapshot: "Operador", opening_amount: "100" }] };
      if (sql.includes("FROM public.products")) return { rows: [{ id: "product-1", code: "SKU-1", name: "Arroz", unit: "un", price: "10.00", cost: "4.00", stock: "5.000", active: true }] };
      if (sql.includes("UPDATE public.products")) return { rowCount: 1, rows: [] };
      return { rows: [] };
    });
    beginAuthenticatedTransaction.mockResolvedValue({
      client, identity: { userId: USER, accountId: ACCOUNT, role: "pdv", username: "operador", displayName: "Operador", permissions: ["PDV"] },
    });
  });
  afterEach(() => {
    if (previousProvider === undefined) delete process.env.MOBFLOW_AUTH_PROVIDER;
    else process.env.MOBFLOW_AUTH_PROVIDER = previousProvider;
  });

  it("records sale, item, payment, stock and ledger in one committed transaction", async () => {
    const response = await handleMobFlowSale(request());
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body).toMatchObject({ ok: true, replayed: false, sale: { id: "sale-100", total: 20, change: 5 } });
    const calls = client.query.mock.calls.map((c) => String(c[0]));
    expect(calls.some((q) => q.includes("INSERT INTO public.sales"))).toBe(true);
    expect(calls.some((q) => q.includes("INSERT INTO public.sale_items"))).toBe(true);
    expect(calls.some((q) => q.includes("INSERT INTO public.sale_payments"))).toBe(true);
    expect(calls.some((q) => q.includes("UPDATE public.products"))).toBe(true);
    expect(calls.some((q) => q.includes("INSERT INTO public.stock_movements"))).toBe(true);
    expect(calls.filter((q) => q.includes("mobflow_append_sync_event"))).toHaveLength(2);
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("rejects sale when stock is insufficient without committing anything", async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("to_regclass")) return { rows: [{ sales: "sales", items: "sale_items", payments: "sale_payments", stock: "stock_movements", events: "mobflow_sync_events", append_fn: "mobflow_append_sync_event" }] };
      if (sql.includes("FROM public.sales WHERE")) return { rows: [] };
      if (sql.includes("FROM public.cash_sessions")) return { rows: [{ id: "cash-1", status: "open", operator_profile_id: USER }] };
      if (sql.includes("FROM public.products")) return { rows: [{ id: "product-1", code: "SKU-1", name: "Arroz", unit: "un", price: "10", cost: "4", stock: "1", active: true }] };
      return { rows: [] };
    });
    const response = await handleMobFlowSale(request());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("insufficient_stock");
    expect(client.query.mock.calls.some((c) => String(c[0]).includes("INSERT INTO public.sales"))).toBe(false);
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });

  it("returns the original sale on retry with the same idempotency key", async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("to_regclass")) return { rows: [{ sales: "sales", items: "sale_items", payments: "sale_payments", stock: "stock_movements", events: "mobflow_sync_events", append_fn: "mobflow_append_sync_event" }] };
      if (sql.includes("FROM public.sales WHERE")) return { rows: [{ id: "sale-100", total: "20", payment_method: "cash", payment_status: "paid", cash_session_id: "cash-1" }] };
      if (sql.includes("FROM public.sale_items")) return { rows: [{ product_id: "product-1", quantity: "2", line_total: "20" }] };
      return { rows: [] };
    });
    const response = await handleMobFlowSale(request());
    expect(await response.json()).toMatchObject({ ok: true, replayed: true, sale: { id: "sale-100", total: 20 } });
    expect(client.query.mock.calls.some((c) => String(c[0]).includes("INSERT INTO public.sales"))).toBe(false);
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("rejects a reused idempotency key for another sale id", async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("to_regclass")) return { rows: [{ sales: "sales", items: "sale_items", payments: "sale_payments", stock: "stock_movements", events: "mobflow_sync_events", append_fn: "mobflow_append_sync_event" }] };
      if (sql.includes("FROM public.sales WHERE")) return { rows: [{ id: "different-sale", total: "20", payment_method: "cash", payment_status: "paid", cash_session_id: "cash-1" }] };
      return { rows: [] };
    });
    const response = await handleMobFlowSale(request());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("idempotency_conflict");
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });
});
