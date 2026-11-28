// Dedicated offline search runtime: keeps catalog indexing and queries off the PDV UI thread.
import type { OfflineSearchDelta, OfflineSearchDocument } from "./offline-search-engine";

// FlexSearch's IndexedDB adapter detects the browser database through
// window.indexedDB. Dedicated workers expose the same APIs on globalThis,
// so provide the browser-global alias before dynamically loading FlexSearch.
const workerGlobal = globalThis as typeof globalThis & { window?: typeof globalThis };
if (typeof workerGlobal.window === "undefined") {
  Object.defineProperty(workerGlobal, "window", { value: workerGlobal, configurable: true });
}
const enginePromise = import("./offline-search-engine").then(({ OfflineProductSearchEngine }) => new OfflineProductSearchEngine());

type Request =
  | { id: number; type: "initialize"; tenantId: string; products: OfflineSearchDocument[] }
  | { id: number; type: "search"; query: string; limit: number }
  | { id: number; type: "delta"; changes: OfflineSearchDelta[] };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: unknown) => void;
};
let queue = Promise.resolve();

async function handle(request: Request) {
  try {
    const engine = await enginePromise;
    let result: unknown;
    if (request.type === "initialize") {
      result = await engine.initialize(request.tenantId, request.products);
    } else if (request.type === "search") {
      result = await engine.search(request.query, request.limit);
    } else {
      await engine.applyDelta(request.changes);
      result = true;
    }
    workerScope.postMessage({ id: request.id, ok: true, result });
  } catch (error) {
    workerScope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "Falha na pesquisa offline.",
    });
  }
}

workerScope.onmessage = (event) => {
  const request = event.data;
  queue = queue.then(() => handle(request)).catch((error) => {
    workerScope.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : "Falha na pesquisa offline." });
  });
};
