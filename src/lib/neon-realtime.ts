import { createRealtimeClient, type SealedLiveQuery } from "@neon/realtime/client";

type LatestTenantEvent = { event_id: string };

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

export async function subscribeToTenantEvents(
  onEvent: () => void,
  onError?: (message: string) => void,
): Promise<() => void> {
  const response = await fetch("/api/mobflow/sync/live-query", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`Não foi possível iniciar a sincronização em tempo real (HTTP ${response.status}).`);
  }

  const sealedQuery = (await response.json()) as SealedLiveQuery<LatestTenantEvent>;
  const client = getRealtimeClient();
  const subscription = client.subscribe(sealedQuery);
  let lastEventId: string | null | undefined;

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
    if (state.status === "error") onError?.(state.error.message);
  });

  return () => {
    removeChangeListener();
    removeStateListener();
    subscription.unsubscribe();
    client.close();
    realtimeClient = null;
  };
}
