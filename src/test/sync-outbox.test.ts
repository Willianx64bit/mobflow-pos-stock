import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import {
  createSyncCommand,
  flushSyncOutbox,
  isValidSyncCursor,
  pullSyncEvents,
  SyncOutbox,
  type SyncCommand,
  type SyncEvent,
} from "@/lib/sync-outbox";

const TENANT = "9c47eaac-2abf-4cd6-b614-24e27077bdf6";
const ID = "a6c47ea1-2abf-4cd6-b614-24e27077bdf6";

function outboxMock(overrides: Record<string, unknown> = {}) {
  return {
    listPending: vi.fn().mockResolvedValue([]),
    markAttempt: vi.fn().mockResolvedValue(undefined),
    acknowledge: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    pendingCount: vi.fn().mockResolvedValue(0),
    getCursor: vi.fn().mockResolvedValue("0"),
    setCursor: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SyncOutbox;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("MobFlow durable incremental outbox contract", () => {
  it("accepts numeric global and receiving/conference cursors", () => {
    expect(isValidSyncCursor("0")).toBe(true);
    expect(isValidSyncCursor("123456789")).toBe(true);
    expect(isValidSyncCursor("")).toBe(false);
    expect(isValidSyncCursor("12x")).toBe(false);
  });

  it("isolates pending commands and counts by tenant on a shared computer", async () => {
    const otherTenant = "7c47eaac-2abf-4cd6-b614-24e27077bdf6";
    const first = createSyncCommand({
      tenantId: TENANT,
      domain: "cash",
      id: "c6c47ea1-2abf-4cd6-b614-24e27077bdf6",
      idempotencyKey: "d6c47ea1-2abf-4cd6-b614-24e27077bdf6",
      payload: { action: "open", sessionId: "tenant-a-cash" },
    });
    const second = createSyncCommand({
      tenantId: otherTenant,
      domain: "cash",
      id: "e6c47ea1-2abf-4cd6-b614-24e27077bdf6",
      idempotencyKey: "f6c47ea1-2abf-4cd6-b614-24e27077bdf6",
      payload: { action: "open", sessionId: "tenant-b-cash" },
    });
    const outbox = new SyncOutbox();
    await outbox.enqueue(first);
    await outbox.enqueue(second);
    await expect(outbox.listPending(TENANT)).resolves.toEqual([first]);
    await expect(outbox.pendingCount(TENANT)).resolves.toBe(1);
    await expect(outbox.listPending(otherTenant)).resolves.toEqual([second]);
    await expect(outbox.pendingCount(otherTenant)).resolves.toBe(1);
    outbox.close();
  });

  it("creates stable domain endpoint and keeps idempotency key in the payload", () => {
    const command = createSyncCommand({
      tenantId: TENANT,
      domain: "sales",
      id: ID,
      idempotencyKey: ID,
      payload: { saleId: "sale-1", cashSessionId: "cash-1" },
    });
    expect(command.endpoint).toBe("/api/mobflow/sales");
    expect(command.payload).toMatchObject({ saleId: "sale-1", cashSessionId: "cash-1", idempotencyKey: ID });
    expect(command.status).toBe("pending");
    expect(command.attempts).toBe(0);
  });

  it("routes receivable payments through the dedicated idempotent endpoint", () => {
    const command = createSyncCommand({ tenantId: TENANT, domain: "receivables", id: ID, idempotencyKey: ID, payload: { saleId: "sale-1", amount: 12.5, paymentMethod: "pix" } });
    expect(command.endpoint).toBe("/api/mobflow/receivables");
    expect(command.payload).toMatchObject({ saleId: "sale-1", amount: 12.5, paymentMethod: "pix", idempotencyKey: ID });
  });

  it("keeps dependent commands in a deterministic creation order", () => {
    const first = createSyncCommand({ tenantId: TENANT, domain: "cash", id: ID, idempotencyKey: ID, payload: { action: "open", sessionId: "cash-1" } });
    const secondId = "b6c47ea1-2abf-4cd6-b614-24e27077bdf6";
    const second = createSyncCommand({ tenantId: TENANT, domain: "sales", id: secondId, idempotencyKey: secondId, payload: { saleId: "sale-1" } });
    expect(Date.parse(second.createdAt)).toBeGreaterThan(Date.parse(first.createdAt));
  });

  it("rejects malformed tenant and idempotency identifiers before queueing", () => {
    expect(() => createSyncCommand({ tenantId: "", domain: "cash", id: ID, idempotencyKey: ID, payload: {} })).toThrow();
    expect(() => createSyncCommand({ tenantId: TENANT, domain: "stock", id: ID, idempotencyKey: "not-a-uuid", payload: {} })).toThrow();
  });

  it("acknowledges a command only after the server confirms success", async () => {
    const command: SyncCommand = createSyncCommand({ tenantId: TENANT, domain: "cash", id: ID, idempotencyKey: ID, payload: { action: "open", sessionId: "cash-1" } });
    const outbox = outboxMock({
      listPending: vi.fn().mockResolvedValue([command]),
      pendingCount: vi.fn().mockResolvedValue(0),
    });
    const transport = vi.fn().mockResolvedValue(response({ ok: true, replayed: false }));
    const result = await flushSyncOutbox(outbox, TENANT, transport);
    expect(transport).toHaveBeenCalledWith("/api/mobflow/cash", expect.objectContaining({ method: "POST" }));
    expect(outbox.markAttempt).toHaveBeenCalledWith(ID);
    expect(outbox.acknowledge).toHaveBeenCalledWith(ID);
    expect(outbox.markFailed).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sent: 1, failed: 0, pending: 0 });
  });

  it("does not acknowledge an HTTP success without an explicit ok confirmation", async () => {
    const command = createSyncCommand({ tenantId: TENANT, domain: "cash", id: ID, idempotencyKey: ID, payload: { action: "open", sessionId: "cash-1" } });
    const outbox = outboxMock({
      listPending: vi.fn().mockResolvedValue([command]),
      pendingCount: vi.fn().mockResolvedValue(1),
    });
    const transport = vi.fn().mockResolvedValue(response({ message: "response without transaction confirmation" }, 200));
    const result = await flushSyncOutbox(outbox, TENANT, transport);
    expect(outbox.acknowledge).not.toHaveBeenCalled();
    expect(outbox.markFailed).toHaveBeenCalledWith(ID, "Falha HTTP 200");
    expect(result).toMatchObject({ sent: 0, failed: 1, pending: 1 });
  });

  it("retains a command after network or retryable server failure", async () => {
    const command = createSyncCommand({ tenantId: TENANT, domain: "stock", id: ID, idempotencyKey: ID, payload: { operationId: "op-1" } });
    const outbox = outboxMock({
      listPending: vi.fn().mockResolvedValue([command]),
      pendingCount: vi.fn().mockResolvedValue(1),
    });
    const transport = vi.fn().mockResolvedValue(response({ ok: false }, 503));
    const result = await flushSyncOutbox(outbox, TENANT, transport);
    expect(outbox.acknowledge).not.toHaveBeenCalled();
    expect(outbox.markFailed).not.toHaveBeenCalled();
    expect(result.pending).toBe(1);
  });

  it("keeps commands pending when the session needs authentication again", async () => {
    const command = createSyncCommand({ tenantId: TENANT, domain: "cash", id: ID, idempotencyKey: ID, payload: { action: "open", sessionId: "cash-1" } });
    const outbox = outboxMock({
      listPending: vi.fn().mockResolvedValue([command]),
      pendingCount: vi.fn().mockResolvedValue(1),
    });
    const transport = vi.fn().mockResolvedValue(response({ ok: false, code: "unauthorized" }, 401));
    const result = await flushSyncOutbox(outbox, TENANT, transport);
    expect(outbox.acknowledge).not.toHaveBeenCalled();
    expect(outbox.markFailed).not.toHaveBeenCalled();
    expect(result.pending).toBe(1);
  });

  it("marks permanent business errors for explicit user retry instead of looping forever", async () => {
    const command = createSyncCommand({ tenantId: TENANT, domain: "sales", id: ID, idempotencyKey: ID, payload: { saleId: "sale-1" } });
    const outbox = outboxMock({
      listPending: vi.fn().mockResolvedValue([command]),
      pendingCount: vi.fn().mockResolvedValue(0),
    });
    const transport = vi.fn().mockResolvedValue(response({ ok: false, error: "Estoque insuficiente." }, 409));
    const result = await flushSyncOutbox(outbox, TENANT, transport);
    expect(outbox.markFailed).toHaveBeenCalledWith(ID, "Estoque insuficiente.");
    expect(outbox.acknowledge).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });

  it("stops the queue after a permanent failure so later dependent commands are not sent", async () => {
    const first = createSyncCommand({ tenantId: TENANT, domain: "cash", id: ID, idempotencyKey: ID, payload: { action: "open", sessionId: "cash-1" } });
    const secondId = "b6c47ea1-2abf-4cd6-b614-24e27077bdf6";
    const second = createSyncCommand({ tenantId: TENANT, domain: "cash", id: secondId, idempotencyKey: secondId, payload: { action: "movement", sessionId: "cash-1" } });
    const outbox = outboxMock({
      listPending: vi.fn().mockResolvedValue([first, second]),
      pendingCount: vi.fn().mockResolvedValue(1),
    });
    const transport = vi.fn().mockResolvedValue(response({ ok: false, error: "Caixa já existe." }, 409));
    const result = await flushSyncOutbox(outbox, TENANT, transport);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(outbox.markFailed).toHaveBeenCalledWith(ID, "Caixa já existe.");
    expect(result).toMatchObject({ sent: 0, failed: 1, pending: 1 });
  });

  it("uses an independent receiving/conference cursor and requests only those categories", async () => {
    const receivingEvent: SyncEvent = {
      event_id: "receiving-event", sequence: "12", category: "receiving", delivery_mode: "automatic",
      entity_type: "receiving", entity_id: "note-1", payload: { operation: "upsert" }, created_at: "2026-11-12T12:00:00.000Z",
    };
    const outbox = outboxMock({ getCursor: vi.fn().mockResolvedValue("10") });
    const transport = vi.fn().mockResolvedValue(response({
      ok: true, events: [receivingEvent], nextCursor: "20", highWaterMark: "20", hasMore: false,
    }));
    const apply = vi.fn().mockResolvedValue(undefined);
    const result = await pullSyncEvents(outbox, TENANT, apply, transport, 10, "receiving-conference", ["receiving", "conference"]);
    expect(transport).toHaveBeenCalledWith(
      "/api/mobflow/sync/events?cursor=10&limit=100&categories=receiving%2Cconference",
      expect.objectContaining({ method: "GET" }),
    );
    expect(outbox.getCursor).toHaveBeenCalledWith(TENANT, "receiving-conference");
    expect(outbox.setCursor).toHaveBeenCalledWith(TENANT, "20", "receiving-conference");
    expect(apply).toHaveBeenCalledWith([receivingEvent]);
    expect(result.cursor).toBe("20");
  });

  it("rejects any event outside the receiving/conference cursor scope", async () => {
    const stockEvent: SyncEvent = {
      event_id: "stock-event", sequence: "12", category: "stock", delivery_mode: "automatic",
      entity_type: "product", entity_id: "product-1", payload: { stockDelta: 1 }, created_at: "2026-11-12T12:00:00.000Z",
    };
    const outbox = outboxMock({ getCursor: vi.fn().mockResolvedValue("10") });
    const transport = vi.fn().mockResolvedValue(response({
      ok: true, events: [stockEvent], nextCursor: "20", highWaterMark: "20", hasMore: false,
    }));
    const apply = vi.fn();
    await expect(pullSyncEvents(outbox, TENANT, apply, transport, 10, "receiving-conference", ["receiving", "conference"]))
      .rejects.toThrow("categoria fora do escopo");
    expect(apply).not.toHaveBeenCalled();
    expect(outbox.setCursor).not.toHaveBeenCalled();
  });

  it("applies automatic events and advances over skipped manual sequences", async () => {
    const event: SyncEvent = {
      event_id: "event-1", sequence: "4", category: "stock", delivery_mode: "automatic",
      entity_type: "product", entity_id: "product-1", payload: { stockDelta: -1 }, created_at: "2026-11-08T12:00:00.000Z",
    };
    const outbox = outboxMock({ getCursor: vi.fn().mockResolvedValue("3") });
    const transport = vi.fn().mockResolvedValue(response({ ok: true, events: [event], nextCursor: "6", highWaterMark: "6", hasMore: false }));
    const apply = vi.fn().mockResolvedValue(undefined);
    const result = await pullSyncEvents(outbox, TENANT, apply, transport);
    expect(apply).toHaveBeenCalledWith([event]);
    expect(outbox.setCursor).toHaveBeenCalledWith(TENANT, "6", "global");
    expect(result).toMatchObject({ applied: 1, cursor: "6", hasMore: false });
  });

  it("advances the cursor over a page containing only manual events", async () => {
    const outbox = outboxMock({ getCursor: vi.fn().mockResolvedValue("10") });
    const transport = vi.fn().mockResolvedValue(response({ ok: true, events: [], nextCursor: "50", highWaterMark: "50", hasMore: false }));
    const apply = vi.fn();
    const result = await pullSyncEvents(outbox, TENANT, apply, transport);
    expect(apply).not.toHaveBeenCalled();
    expect(outbox.setCursor).toHaveBeenCalledWith(TENANT, "50", "global");
    expect(result).toMatchObject({ applied: 0, cursor: "50", hasMore: false });
  });

  it("rejects duplicate or out-of-order event sequences without applying the page", async () => {
    const events: SyncEvent[] = [
      { event_id: "event-6", sequence: "6", category: "stock", delivery_mode: "automatic", entity_type: "product", entity_id: "p1", payload: {}, created_at: "2026-11-08T12:00:00.000Z" },
      { event_id: "event-5", sequence: "5", category: "stock", delivery_mode: "automatic", entity_type: "product", entity_id: "p1", payload: {}, created_at: "2026-11-08T12:00:01.000Z" },
    ];
    const outbox = outboxMock({ getCursor: vi.fn().mockResolvedValue("4") });
    const transport = vi.fn().mockResolvedValue(response({ ok: true, events, nextCursor: "5", hasMore: false }));
    const apply = vi.fn();
    await expect(pullSyncEvents(outbox, TENANT, apply, transport)).rejects.toThrow("fora de ordem");
    expect(apply).not.toHaveBeenCalled();
    expect(outbox.setCursor).not.toHaveBeenCalled();
  });


  it("persists a sale offline across an app restart and syncs it exactly once after reconnection", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("mobflow-incremental-sync");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Database de teste bloqueado."));
    });

    const firstAppInstance = new SyncOutbox();
    const command = createSyncCommand({
      tenantId: TENANT,
      domain: "sales",
      id: ID,
      idempotencyKey: ID,
      payload: { saleId: "offline-sale-1", total: 42.5, payment: "Pix", paymentStatus: "pending_validation" },
    });
    await firstAppInstance.enqueue(command);
    // Close the first app's IndexedDB connection before simulating a fresh process.
    firstAppInstance.close();

    const offlineTransport = vi.fn().mockRejectedValue(new TypeError("Failed to fetch: simulated offline"));
    const offlineResult = await flushSyncOutbox(firstAppInstance, TENANT, offlineTransport);
    expect(offlineResult).toMatchObject({ sent: 0, failed: 0, pending: 1 });
    expect(await firstAppInstance.pendingCount(TENANT)).toBe(1);

    // A new SyncOutbox instance represents closing and reopening the desktop app.
    const reopenedApp = new SyncOutbox();
    const restored = await reopenedApp.listPending(TENANT);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      id: ID,
      idempotencyKey: ID,
      domain: "sales",
      payload: { saleId: "offline-sale-1", total: 42.5, paymentStatus: "pending_validation" },
      status: "pending",
      attempts: 1,
    });

    const onlineTransport = vi.fn().mockImplementation(async () => response({ ok: true, replayed: false }));
    const synced = await flushSyncOutbox(reopenedApp, TENANT, onlineTransport);
    expect(synced).toMatchObject({ sent: 1, failed: 0, pending: 0 });
    expect(onlineTransport).toHaveBeenCalledTimes(1);
    expect(onlineTransport).toHaveBeenCalledWith("/api/mobflow/sales", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"idempotencyKey":"a6c47ea1-2abf-4cd6-b614-24e27077bdf6"'),
    }));
    expect(await reopenedApp.pendingCount(TENANT)).toBe(0);
    reopenedApp.close();
  });

  it("restores sale, cash and stock commands after restart and syncs each idempotently", async () => {
    const restartTenant = "tenant-restart-operations";
    const firstInstance = new SyncOutbox();
    const specs = [
      { domain: "sales" as const, id: "b6c47ea1-2abf-4cd6-b614-24e27077bdf1", key: "b6c47ea1-2abf-4cd6-b614-24e27077bdf2", payload: { saleId: "sale-restart-2", total: 15 } },
      { domain: "cash" as const, id: "c6c47ea1-2abf-4cd6-b614-24e27077bdf1", key: "c6c47ea1-2abf-4cd6-b614-24e27077bdf2", payload: { movementId: "cash-restart-2", amount: 20 } },
      { domain: "stock" as const, id: "d6c47ea1-2abf-4cd6-b614-24e27077bdf1", key: "d6c47ea1-2abf-4cd6-b614-24e27077bdf2", payload: { operationId: "stock-restart-2", quantity: 3 } },
    ];
    for (const spec of specs) {
      await firstInstance.enqueue(createSyncCommand({ tenantId: restartTenant, ...spec }));
    }
    firstInstance.close();

    const offlineTransport = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const offline = new SyncOutbox();
    expect(await flushSyncOutbox(offline, restartTenant, offlineTransport)).toMatchObject({ sent: 0, pending: 3 });
    offline.close();

    const reopened = new SyncOutbox();
    expect(await reopened.listPending(restartTenant)).toHaveLength(3);
    const onlineTransport = vi.fn().mockImplementation(async () => response({ ok: true, replayed: false }));
    expect(await flushSyncOutbox(reopened, restartTenant, onlineTransport)).toMatchObject({ sent: 3, failed: 0, pending: 0 });
    expect(onlineTransport).toHaveBeenCalledTimes(3);
    expect(onlineTransport.mock.calls.map((call) => call[0]).sort()).toEqual([
      "/api/mobflow/cash", "/api/mobflow/sales", "/api/mobflow/stock",
    ]);
    expect(await flushSyncOutbox(reopened, restartTenant, onlineTransport)).toMatchObject({ sent: 0, pending: 0 });
    expect(onlineTransport).toHaveBeenCalledTimes(3);
    reopened.close();
  });

  it("does not advance the cursor if applying an event page fails", async () => {
    const event: SyncEvent = {
      event_id: "event-2", sequence: "5", category: "sales", delivery_mode: "automatic",
      entity_type: "sale", entity_id: "sale-1", payload: {}, created_at: "2026-11-08T12:00:00.000Z",
    };
    const outbox = outboxMock({ getCursor: vi.fn().mockResolvedValue("4") });
    const transport = vi.fn().mockResolvedValue(response({ ok: true, events: [event], nextCursor: "5", hasMore: false }));
    await expect(pullSyncEvents(outbox, TENANT, async () => { throw new Error("apply failed"); }, transport)).rejects.toThrow("apply failed");
    expect(outbox.setCursor).not.toHaveBeenCalled();
  });
});
