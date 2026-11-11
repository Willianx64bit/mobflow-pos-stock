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

import { handleMobFlowReceiving } from "@/routes/api/mobflow/receiving";

const ACCOUNT_ID = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const baseState = () => ({
  products: [{ id: "product-a", stock: 10 }, { id: "product-b", stock: 4 }],
  receiving: [{
    id: "note-1",
    status: "analisando",
    decisionCompleted: false,
    stockReleased: false,
    items: [{ productId: "product-a", received: 3 }],
    extras: [{ productId: "product-b", received: 2 }],
    decisions: {},
  }],
});

function request(action: string, decisions?: Record<string, string>) {
  return new Request("https://mobflow.test/api/mobflow/receiving", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, receivingId: "note-1", decisions }),
  });
}

describe("Neon receiving stock release", () => {
  const originalProvider = process.env["MOBFLOW_AUTH_PROVIDER"];
  let state: ReturnType<typeof baseState>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env["MOBFLOW_AUTH_PROVIDER"] = "better-auth";
    state = baseState();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT state FROM public.app_state")) return { rows: [{ state }] };
      if (sql.includes("UPDATE public.app_state")) return { rows: [], rowCount: 1 };
      return { rows: [] };
    });
    beginAuthenticatedTransaction.mockResolvedValue({
      client,
      identity: { userId: ACCOUNT_ID, accountId: ACCOUNT_ID, role: "manager", permissions: ["Gerência"] },
    });
  });

  afterEach(() => {
    if (originalProvider === undefined) delete process.env["MOBFLOW_AUTH_PROVIDER"];
    else process.env["MOBFLOW_AUTH_PROVIDER"] = originalProvider;
  });

  it("finalizes decisions and releases accepted stock atomically", async () => {
    const response = await handleMobFlowReceiving(request("finalize_decisions", {
      "product-a": "aceitar",
      "product-b": "devolver",
    }));
    const body = await response.json();
    const updateCall = client.query.mock.calls.find((call) => String(call[0]).includes("UPDATE public.app_state"));
    const saved = JSON.parse(updateCall?.[1]?.[1] as string);

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: true });
    expect(saved.products).toEqual([{ id: "product-a", stock: 13 }, { id: "product-b", stock: 4 }]);
    expect(saved.receiving[0]).toMatchObject({
      decisions: { "product-a": "aceitar", "product-b": "devolver" },
      decisionCompleted: true,
      status: "aceito",
      stockReleased: true,
    });
    const eventCalls = client.query.mock.calls.filter((call) =>
      String(call[0]).includes("mobflow_append_sync_event"),
    );
    expect(eventCalls).toHaveLength(2);
    expect(eventCalls[0]![0]).toContain("'receiving', 'manual'");
    expect(eventCalls[1]![0]).toContain("'stock', 'automatic'");
    expect(eventCalls[1]![1][2]).toBe("product-a");
    expect(JSON.parse(eventCalls[1]![1][3] as string)).toMatchObject({
      stockDelta: 3, source: "receiving",
    });
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("does not release stock when a decision is missing", async () => {
    const response = await handleMobFlowReceiving(request("finalize_decisions", { "product-a": "aceitar" }));
    expect(await response.json()).toEqual({ ok: true, data: false });
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE public.app_state"), expect.anything());
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });


  it("does not commit or append events when the existing product stock is invalid", async () => {
    state.products[0].stock = "not-a-number" as unknown as number;
    const response = await handleMobFlowReceiving(request("finalize_decisions", {
      "product-a": "aceitar",
      "product-b": "devolver",
    }));

    expect(response.status).toBe(500);
    expect(client.query.mock.calls.some((call) =>
      String(call[0]).includes("mobflow_append_sync_event"),
    )).toBe(false);
    expect(client.query.mock.calls.some((call) =>
      String(call[0]).includes("UPDATE public.app_state"),
    )).toBe(false);
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });

  it("accepts a completed decision and releases stock once", async () => {
    state.receiving[0].decisionCompleted = true;
    state.receiving[0].decisions = { "product-a": "aceitar", "product-b": "devolver" };
    const response = await handleMobFlowReceiving(request("accept"));
    const body = await response.json();
    const updateCall = client.query.mock.calls.find((call) => String(call[0]).includes("UPDATE public.app_state"));
    const saved = JSON.parse(updateCall?.[1]?.[1] as string);

    expect(body).toEqual({ ok: true, data: true });
    expect(saved.products[0].stock).toBe(13);
    expect(saved.receiving[0].stockReleased).toBe(true);
    const eventCalls = client.query.mock.calls.filter((call) =>
      String(call[0]).includes("mobflow_append_sync_event"),
    );
    expect(eventCalls).toHaveLength(2);
    expect(eventCalls[0]![0]).toContain("'receiving', 'manual'");
    expect(eventCalls[1]![0]).toContain("'stock', 'automatic'");
    expect(releaseTransaction).toHaveBeenCalledWith(client, true);
  });

  it("does not append or apply stock events when the same receiving is accepted again", async () => {
    state.receiving[0].decisionCompleted = true;
    state.receiving[0].decisions = { "product-a": "aceitar", "product-b": "devolver" };
    state.receiving[0].stockReleased = true;
    state.products[0].stock = 13;

    const response = await handleMobFlowReceiving(request("accept"));

    expect(await response.json()).toEqual({ ok: true, data: false });
    expect(client.query.mock.calls.some((call) =>
      String(call[0]).includes("mobflow_append_sync_event"),
    )).toBe(false);
    expect(client.query.mock.calls.some((call) =>
      String(call[0]).includes("UPDATE public.app_state"),
    )).toBe(false);
    expect(releaseTransaction).toHaveBeenCalledWith(client, false);
  });
});
