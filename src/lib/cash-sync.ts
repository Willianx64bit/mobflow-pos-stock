import type { SyncEvent } from "@/lib/sync-outbox";

/**
 * The cash endpoint only reconciles the current operator's open session.
 * Query it after events that can change cash-session state, not after sales,
 * catalog, stock, receiving, or unrelated tenant events.
 */
export function shouldReconcileCashSessionAfterSync(events: readonly SyncEvent[]): boolean {
  return events.some((event) =>
    (event.category === "cash" &&
      (event.entity_type === "cash_session" || event.entity_type === "cash_movement")) ||
    (event.category === "master_data" &&
      (event.entity_type === "cash_session" || event.entity_type === "cash_movement"))
  );
}
