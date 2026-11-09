export type SyncDomain = "sales" | "cash" | "stock";
export type SyncCommand = {
  id: string;
  tenantId: string;
  domain: SyncDomain;
  endpoint: "/api/mobflow/sales" | "/api/mobflow/cash" | "/api/mobflow/stock";
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  status: "pending" | "failed";
  lastError?: string;
};

export type SyncEvent = {
  event_id: string;
  sequence: string;
  category: string;
  delivery_mode: "automatic" | "manual";
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type MetaRecord = { key: string; value: string };
const DB_NAME = "mobflow-incremental-sync";
const DB_VERSION = 1;
const COMMANDS = "commands";
const META = "meta";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao acessar a fila local."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Transação local cancelada."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Falha na transação local."));
  });
}

function openDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(COMMANDS)) {
        const store = db.createObjectStore(COMMANDS, { keyPath: "id" });
        store.createIndex("by_created_at", "createdAt", { unique: false });
        store.createIndex("by_idempotency_key", "idempotencyKey", { unique: true });
        store.createIndex("by_tenant_status", ["tenantId", "status"], { unique: false });
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir a fila local."));
    request.onblocked = () => reject(new Error("A fila local está sendo atualizada em outra aba. Feche as outras abas e tente novamente."));
  });
}

function makeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Este dispositivo não oferece geração segura de identificadores.");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createSyncCommand(input: {
  tenantId: string;
  domain: SyncDomain;
  payload: Record<string, unknown>;
  id?: string;
  idempotencyKey?: string;
  createdAt?: string;
}): SyncCommand {
  const endpoint = input.domain === "sales" ? "/api/mobflow/sales" : input.domain === "cash" ? "/api/mobflow/cash" : "/api/mobflow/stock";
  const id = input.id ?? makeUuid();
  const idempotencyKey = input.idempotencyKey ?? makeUuid();
  if (!input.tenantId.trim() || !UUID_RE.test(id) || !UUID_RE.test(idempotencyKey)) {
    throw new Error("Identificadores inválidos para a fila incremental.");
  }
  return {
    id, tenantId: input.tenantId, domain: input.domain, endpoint, idempotencyKey,
    payload: { ...input.payload, idempotencyKey },
    createdAt: input.createdAt ?? new Date().toISOString(),
    attempts: 0, status: "pending",
  };
}

export class SyncOutbox {
  private database: Promise<IDBDatabase> | null = null;
  constructor(private readonly factory?: IDBFactory) {}

  private db() {
    if (!this.database) this.database = openDatabase(this.factory);
    return this.database;
  }

  async enqueue(command: SyncCommand): Promise<SyncCommand> {
    const expectedEndpoint = command.domain === "sales" ? "/api/mobflow/sales" : command.domain === "cash" ? "/api/mobflow/cash" : command.domain === "stock" ? "/api/mobflow/stock" : null;
    if (!UUID_RE.test(command.id) || !UUID_RE.test(command.idempotencyKey) ||
      !command.tenantId.trim() || command.endpoint !== expectedEndpoint ||
      command.payload?.["idempotencyKey"] !== command.idempotencyKey) {
      throw new Error("Comando incremental inválido.");
    }
    const db = await this.db();
    const transaction = db.transaction(COMMANDS, "readwrite");
    const store = transaction.objectStore(COMMANDS);
    const existing = await requestValue(store.index("by_idempotency_key").get(command.idempotencyKey)) as SyncCommand | undefined;
    if (existing) {
      const same = existing.tenantId === command.tenantId && existing.domain === command.domain &&
        existing.endpoint === command.endpoint && JSON.stringify(existing.payload) === JSON.stringify(command.payload);
      if (!same) {
        transaction.abort();
        throw new Error("Chave de idempotência já usada por outro comando.");
      }
      await transactionDone(transaction);
      return existing;
    }
    store.add(command);
    await transactionDone(transaction);
    return command;
  }

  async listPending(tenantId: string, limit = 50): Promise<SyncCommand[]> {
    const db = await this.db();
    const transaction = db.transaction(COMMANDS, "readonly");
    const records = await requestValue(transaction.objectStore(COMMANDS).getAll()) as SyncCommand[];
    await transactionDone(transaction);
    // A permanent failure blocks later commands until the user explicitly retries
    // the failed operation. This preserves causal order for dependent cash/sales/stock work.
    if (records.some((item) => item.tenantId === tenantId && item.status === "failed")) return [];
    return records.filter((item) => item.tenantId === tenantId && item.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, Math.max(1, Math.min(limit, 250)));
  }

  async markAttempt(id: string): Promise<void> {
    const db = await this.db();
    const transaction = db.transaction(COMMANDS, "readwrite");
    const store = transaction.objectStore(COMMANDS);
    const item = await requestValue(store.get(id)) as SyncCommand | undefined;
    if (item) store.put({ ...item, attempts: item.attempts + 1 });
    await transactionDone(transaction);
  }

  async acknowledge(id: string): Promise<void> {
    const db = await this.db();
    const transaction = db.transaction(COMMANDS, "readwrite");
    transaction.objectStore(COMMANDS).delete(id);
    await transactionDone(transaction);
  }

  async markFailed(id: string, message: string): Promise<void> {
    const db = await this.db();
    const transaction = db.transaction(COMMANDS, "readwrite");
    const store = transaction.objectStore(COMMANDS);
    const item = await requestValue(store.get(id)) as SyncCommand | undefined;
    if (item) store.put({ ...item, status: "failed", lastError: message.slice(0, 500) });
    await transactionDone(transaction);
  }

  async retryFailed(tenantId: string): Promise<number> {
    const db = await this.db();
    const transaction = db.transaction(COMMANDS, "readwrite");
    const store = transaction.objectStore(COMMANDS);
    const records = await requestValue(store.getAll()) as SyncCommand[];
    let count = 0;
    for (const item of records) {
      if (item.tenantId === tenantId && item.status === "failed") {
        store.put({ ...item, status: "pending", lastError: undefined });
        count++;
      }
    }
    await transactionDone(transaction);
    return count;
  }

  async pendingCount(tenantId: string): Promise<number> {
    const db = await this.db();
    const transaction = db.transaction(COMMANDS, "readonly");
    const records = await requestValue(transaction.objectStore(COMMANDS).getAll()) as SyncCommand[];
    await transactionDone(transaction);
    return records.filter((item) => item.tenantId === tenantId && item.status === "pending").length;
  }

  async failedCount(tenantId: string): Promise<number> {
    const db = await this.db();
    const transaction = db.transaction(COMMANDS, "readonly");
    const records = await requestValue(transaction.objectStore(COMMANDS).getAll()) as SyncCommand[];
    await transactionDone(transaction);
    return records.filter((item) => item.tenantId === tenantId && item.status === "failed").length;
  }

  async clearTenant(tenantId: string): Promise<void> {
    const db = await this.db();
    const transaction = db.transaction([COMMANDS, META], "readwrite");
    const commandsStore = transaction.objectStore(COMMANDS);
    const records = await requestValue(commandsStore.getAll()) as SyncCommand[];
    for (const command of records) {
      if (command.tenantId === tenantId) commandsStore.delete(command.id);
    }
    transaction.objectStore(META).delete(`cursor:${tenantId}`);
    await transactionDone(transaction);
  }

  async getCursor(tenantId: string): Promise<string> {
    const db = await this.db();
    const transaction = db.transaction(META, "readonly");
    const record = await requestValue(transaction.objectStore(META).get(`cursor:${tenantId}`)) as MetaRecord | undefined;
    await transactionDone(transaction);
    return record?.value ?? "0";
  }

  async setCursor(tenantId: string, cursor: string): Promise<void> {
    if (!/^\d+$/.test(cursor)) throw new Error("Cursor incremental inválido.");
    const db = await this.db();
    const transaction = db.transaction(META, "readwrite");
    const store = transaction.objectStore(META);
    const key = `cursor:${tenantId}`;
    const current = await requestValue(store.get(key)) as MetaRecord | undefined;
    if (BigInt(cursor) > BigInt(current?.value ?? "0")) store.put({ key, value: cursor } satisfies MetaRecord);
    await transactionDone(transaction);
  }

  close(): void {
    void this.database?.then((db) => db.close());
    this.database = null;
  }
}

export type SyncTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type OutboxFlushResult = { sent: number; failed: number; pending: number };

const isRetryable = (status: number) => status === 401 || status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;

export async function flushSyncOutbox(
  outbox: SyncOutbox,
  tenantId: string,
  transport: SyncTransport = fetch,
  limit = 25,
): Promise<OutboxFlushResult> {
  const commands = await outbox.listPending(tenantId, limit);
  let sent = 0, failed = 0;
  for (const command of commands) {
    await outbox.markAttempt(command.id);
    try {
      const response = await transport(command.endpoint, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command.payload),
      });
      const body = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; code?: string };
      if (response.ok && body.ok !== false) {
        await outbox.acknowledge(command.id);
        sent++;
      } else if (isRetryable(response.status)) {
        break;
      } else {
        await outbox.markFailed(command.id, body.error ?? `Falha HTTP ${response.status}`);
        failed++;
        // Do not send later commands that may depend on the rejected operation.
        break;
      }
    } catch {
      // Keep the command pending. Its stable idempotency key makes retry safe after a lost response.
      break;
    }
  }
  return { sent, failed, pending: await outbox.pendingCount(tenantId) };
}

export async function pullSyncEvents(
  outbox: SyncOutbox,
  tenantId: string,
  applyEvents: (events: SyncEvent[]) => Promise<void> | void,
  transport: SyncTransport = fetch,
  maxPages = 10,
): Promise<{ applied: number; cursor: string; hasMore: boolean }> {
  let cursor = await outbox.getCursor(tenantId);
  let applied = 0, hasMore = false;
  for (let pageNumber = 0; pageNumber < Math.max(1, maxPages); pageNumber++) {
    const response = await transport(`/api/mobflow/sync/events?cursor=${encodeURIComponent(cursor)}&limit=100`, {
      method: "GET", credentials: "same-origin",
    });
    if (!response.ok) throw new Error(`Falha ao receber alterações do Neon (HTTP ${response.status}).`);
    const body = await response.json() as { ok?: boolean; events?: SyncEvent[]; nextCursor?: string; hasMore?: boolean };
    if (body.ok !== true || !Array.isArray(body.events) || typeof body.nextCursor !== "string" || !/^\d+$/.test(body.nextCursor)) {
      throw new Error("Resposta inválida ao receber alterações do Neon.");
    }
    if (BigInt(body.nextCursor) < BigInt(cursor)) throw new Error("O cursor recebido regrediu.");
    if (body.events.length) {
      let previousSequence = BigInt(cursor);
      for (const event of body.events) {
        if (!/^\d+$/.test(event.sequence) || BigInt(event.sequence) <= previousSequence) {
          throw new Error("A página de eventos contém sequência inválida ou fora de ordem.");
        }
        previousSequence = BigInt(event.sequence);
      }
      if (BigInt(body.nextCursor) !== previousSequence) throw new Error("A página de eventos não corresponde ao cursor informado.");
      await applyEvents(body.events);
      await outbox.setCursor(tenantId, body.nextCursor);
      cursor = body.nextCursor;
      applied += body.events.length;
    }
    hasMore = body.hasMore === true;
    if (!hasMore || body.events.length === 0) break;
  }
  return { applied, cursor, hasMore };
}

export async function runIncrementalSync(input: {
  outbox: SyncOutbox;
  tenantId: string;
  applyEvents: (events: SyncEvent[]) => Promise<void> | void;
  transport?: SyncTransport;
}): Promise<{ sent: number; failed: number; pending: number; applied: number; cursor: string; hasMore: boolean }> {
  const pushed = await flushSyncOutbox(input.outbox, input.tenantId, input.transport);
  const pulled = await pullSyncEvents(input.outbox, input.tenantId, input.applyEvents, input.transport);
  return { ...pushed, ...pulled };
}
