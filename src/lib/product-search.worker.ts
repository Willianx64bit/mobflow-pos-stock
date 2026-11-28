import { OfflineProductSearchEngine, type OfflineSearchDelta, type OfflineSearchDocument } from "./offline-search-engine";

type Request =
  | { id: number; type: "initialize"; tenantId: string; products: OfflineSearchDocument[] }
  | { id: number; type: "search"; query: string; limit: number }
  | { id: number; type: "delta"; changes: OfflineSearchDelta[] };

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (message: unknown) => void;
};
const engine = new OfflineProductSearchEngine();
let queue = Promise.resolve();

async function handle(request: Request) {
  try {
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
