import { describe, expect, it, vi } from "vitest";
import {
  createSyncCommand,
  flushSyncOutbox,
  pullSyncEvents,
  type SyncCommand,
  type SyncEvent,
  type SyncOutbox,
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

  it("persists the pull cursor only after the event page is applied", async () => {
    const event: SyncEvent = {
      event_id: "event-1", sequence: "4", category: "stock", delivery_mode: "automatic",
      entity_type: "product", entity_id: "product-1", payload: { stockDelta: -1 }, created_at: "2026-11-08T12:00:00.000Z",
    };
    const outbox = outboxMock({ getCursor: vi.fn().mockResolvedValue("3") });
    const transport = vi.fn().mockResolvedValue(response({ ok: true, events: [event], nextCursor: "4", hasMore: false }));
    const apply = vi.fn().mockResolvedValue(undefined);
    const result = await pullSyncEvents(outbox, TENANT, apply, transport);
    expect(apply).toHaveBeenCalledWith([event]);
    expect(outbox.setCursor).toHaveBeenCalledWith(TENANT, "4");
    expect(result).toMatchObject({ applied: 1, cursor: "4", hasMore: false });
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

  it("does not advance the cursor if applying an event page fails", async () => {
    const event: SyncEvent = {
      event_id: "event-2", sequence: "5", category: "sales", delivery_mode: "manual",
      entity_type: "sale", entity_id: "sale-1", payload: {}, created_at: "2026-11-08T12:00:00.000Z",
    };
    const outbox = outboxMock({ getCursor: vi.fn().mockResolvedValue("4") });
    const transport = vi.fn().mockResolvedValue(response({ ok: true, events: [event], nextCursor: "5", hasMore: false }));
    await expect(pullSyncEvents(outbox, TENANT, async () => { throw new Error("apply failed"); }, transport)).rejects.toThrow("apply failed");
    expect(outbox.setCursor).not.toHaveBeenCalled();
  });
});
