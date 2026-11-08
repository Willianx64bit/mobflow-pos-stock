import { createRealtimeClient, type SealedLiveQuery } from "@neon/realtime/client";

type LatestTenantEvent = { event_id: string };
const RENEW_EARLY_MS = 10_000;
const RETRY_MS = 1_000;

let realtimeClient: ReturnType<typeof createRealtimeClient> | null = null;

function getRealtimeClient() {
  const url = import.meta.env["VITE_NEON_REALTIME_URL"];
  if (!url) throw new Error("Neon Realtime URL is not configured for this Preview.");
  if (!realtimeClient) {
    realtimeClient = createRealtimeClient({
      url,
      logLevel: import.meta.env.DEV ? "warn" : "error",
    });
  }
  return realtimeClient;
}

async function fetchSealedQuery(): Promise<SealedLiveQuery<LatestTenantEvent>> {
  const response = await fetch("/api/mobflow/sync/live-query", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`Não foi possível renovar a sincronização em tempo real (HTTP ${response.status}).`);
  }
  return (await response.json()) as SealedLiveQuery<LatestTenantEvent>;
}

export async function subscribeToTenantEvents(
  onEvent: () => void,
  onError?: (message: string) => void,
): Promise<() => void> {
  const sealedQuery = await fetchSealedQuery();
  const client = getRealtimeClient();
  const subscription = client.subscribe(sealedQuery);
  let lastEventId: string | null | undefined;
  let stopped = false;
  let currentExpiry = sealedQuery.expiresAt;
  let renewalTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleRenewal = (expiresAt: number, delayOverride?: number) => {
    if (renewalTimer) clearTimeout(renewalTimer);
    if (stopped) return;
    const delay = delayOverride ?? Math.max(0, expiresAt - Date.now() - RENEW_EARLY_MS);
    renewalTimer = setTimeout(() => { void renew(); }, delay);
  };

  const renew = async () => {
    if (stopped) return;
    let next: SealedLiveQuery<LatestTenantEvent>;
    try {
      next = await fetchSealedQuery();
    } catch (error) {
      if (Date.now() >= currentExpiry) {
        onError?.(error instanceof Error ? error.message : "Não foi possível renovar a assinatura.");
        stop();
        return;
      }
      scheduleRenewal(currentExpiry, RETRY_MS);
      return;
    }
    currentExpiry = next.expiresAt;
    scheduleRenewal(currentExpiry);
    try {
      await subscription.renew(next);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "A assinatura em tempo real expirou.");
      stop();
    }
  };

  const removeChangeListener = subscription.onChange((snapshot) => {
    const nextEventId = snapshot.data?.[0]?.event_id ?? null;
    if (lastEventId === undefined) {
      lastEventId = nextEventId;
      return;
    }
    if (nextEventId && nextEventId !== lastEventId) {
      lastEventId = nextEventId;
      onEvent();
    }
  });

  const removeStateListener = subscription.onStateChange((state) => {
    if (state.status === "error") {
      onError?.(state.error.message);
      stop();
    }
  });

  function stop() {
    if (stopped) return;
    stopped = true;
    if (renewalTimer) clearTimeout(renewalTimer);
    removeChangeListener();
    removeStateListener();
    subscription.unsubscribe();
    client.close();
    realtimeClient = null;
  }

  scheduleRenewal(sealedQuery.expiresAt);
  return stop;
}
