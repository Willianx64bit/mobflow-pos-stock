import { describe, expect, it } from "vitest";
import type { SyncEvent } from "@/lib/sync-outbox";
import { shouldReconcileCashSessionAfterSync } from "@/lib/cash-sync";

function event(category: string, entity_type: string): SyncEvent {
  return {
    event_id: "event-1",
    sequence: "1",
    category,
    delivery_mode: "automatic",
    entity_type,
    entity_id: "entity-1",
    payload: {},
    created_at: "2026-11-26T00:00:00.000Z",
  };
}

describe("cash session reconciliation after incremental sync", () => {
  it("reconciles when a cash session changes", () => {
    expect(shouldReconcileCashSessionAfterSync([event("cash", "cash_session")])).toBe(true);
  });

  it("reconciles when a cash movement changes", () => {
    expect(shouldReconcileCashSessionAfterSync([event("cash", "cash_movement")])).toBe(true);
  });

  it("supports legacy master-data cash events", () => {
    expect(shouldReconcileCashSessionAfterSync([event("master_data", "cash_session")])).toBe(true);
    expect(shouldReconcileCashSessionAfterSync([event("master_data", "cash_movement")])).toBe(true);
  });

  it("skips the cash API for sales, stock, catalog, receiving, and settings events", () => {
    const unrelated = [
      event("sales", "sale"),
      event("stock", "stock_movement"),
      event("catalog", "product"),
      event("receiving", "receiving"),
      event("settings", "company_settings"),
    ];
    expect(shouldReconcileCashSessionAfterSync(unrelated)).toBe(false);
  });

  it("reconciles a mixed batch if at least one cash event is present", () => {
    expect(shouldReconcileCashSessionAfterSync([
      event("sales", "sale"),
      event("cash", "cash_session"),
      event("stock", "stock_movement"),
    ])).toBe(true);
  });

  it("does not match unrelated entities inside cash categories", () => {
    expect(shouldReconcileCashSessionAfterSync([event("cash", "sale")])).toBe(false);
  });

  it("does not reconcile an empty event batch", () => {
    expect(shouldReconcileCashSessionAfterSync([])).toBe(false);
  });
});
