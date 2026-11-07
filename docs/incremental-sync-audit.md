# Current synchronization audit

Repository: `Willianx64bit/mobflow-pos-stock`
Baseline inspected: `main`
Scope: MobFlow PDV only.

## Confirmed current behavior

- `app_state` is the shared source of truth and stores the business state as one JSONB document per account.
- `refreshFromCloud` selects `state,updated_at` for the account; it downloads the complete JSONB state.
- Realtime subscribes to `UPDATE public.app_state` and receives the full `state` row payload.
- The Realtime handler merges that snapshot, then schedules another full-state read after 180 ms.
- A 3-second interval calls `refreshFromCloud(accountId, true)` even when Realtime is connected.
- Focus, visibility, online, subscription, and compare-and-swap conflict paths can also request full-state reads.
- `persistState` writes the complete local state snapshot to `app_state` with an `updated_at` compare-and-swap.
- `stockMovements` and receiving records are arrays inside the JSONB state, not independent normalized tables.
- The existing stock movement migration in the repository was not present in the applied migration history when audited; it must not be assumed deployed.

## Mutation paths found in the client store

- Sales checkout: `checkout()`.
- Product create/update: `saveProduct()`.
- Product import: `importProducts()`.
- Product deletion: `deleteProduct()`.
- General product field updates: `updateField()`.
- Stock adjustment: `applyStockAdjustmentBatch()`.
- Write-off/loss/consumption: `applyStockWriteoff()`.
- Store transfer: `applyStockTransfer()`.
- Promotions: `savePromotion()`.
- Settings: `updateSettings()`.
- Receiving: `acceptReceiving()`, `completeReceivingDecision()`, and local receiving actions.

## Receiving RPC observations

- The client calls `accept_receiving(p_receiving_id)` to accept a receipt and then hydrates the full store.
- The client calls `finalize_receiving_decisions(p_receiving_id, p_decisions)`; it waits for the pending persist queue before the RPC.
- On successful decision finalization, the client updates local receiving state and starts a background full-store hydration.
- The RPC migrations update `app_state.state` under a row lock, including product stock and receiving status. They do not write to a separate stock table.
- The first `accept_receiving` migration handled `items`; the later extras migration concatenates `items` and `extras`. The stock movement ledger migration also has newer definitions of both receiving RPCs. Before adding event emission, the actual deployed function definitions and migration history must be checked, because the repository contains successive definitions.
- The ledger migration creates stock movement JSON objects inside `app_state.state`; it does not normalize stock movements into a dedicated database table.
- Receiving document/conference/decisions must be manual-sync data while the resulting stock delta is emitted immediately. This is required for both receiving RPCs, and both events must be committed atomically with the state mutation.
- In `finalize_receiving_decisions`, only lines marked `aceitar` contribute to stock. The event implementation must preserve this filtering and must not duplicate a stock delta when a client retries an RPC.

## Sidebar integration point

`src/components/AppHeader.tsx` owns the left sidebar, permissions, authenticated PDV username, and navigation. The sync control should be inserted in this component without changing existing permission checks, route behavior, login/logout, cash menu, theme, or responsive sidebar behavior.

## Important implementation implication

Adding an event table alone will not lower egress while the client continues receiving full `app_state` Realtime payloads, polling every three seconds, and doing full-state hydration after events. The rollout must change the notification source and all recovery paths together, with a feature flag and tests, before disabling legacy polling.
