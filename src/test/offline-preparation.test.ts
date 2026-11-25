import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/neon-realtime", () => ({
  subscribeToTenantEvents: vi.fn(() => () => {}),
}));

vi.mock("@/lib/sync-outbox", () => ({
  SyncOutbox: class {
    pendingCount = vi.fn().mockResolvedValue(0);
    failedCount = vi.fn().mockResolvedValue(0);
  },
  createSyncCommand: vi.fn(),
  flushSyncOutbox: vi.fn(),
  pullSyncEvents: vi.fn(),
  runIncrementalSync: vi.fn(),
}));

describe("verifyDesktopOfflinePreparation", () => {
  const accountId = "company-a";
  const now = new Date("2026-11-25T12:00:00.000Z");

  const validSnapshot = () => ({
    contacts: [],
    products: [{ id: "p-1", code: "123", name: "Produto teste", price: 10, stock: 5, minStock: 0, category: "Geral", unit: "un" }],
    cart: [],
    sales: [],
    stockMovements: [],
    cashSessions: [],
    cashMovements: [],
    conferences: [],
    receiving: [],
    manualExpiries: [],
    stockAdjustments: [],
    stockWriteoffs: [],
    stockTransfers: [],
    promotions: [],
    suppliers: [],
    settings: { companyName: "Mercado Teste", pixKey: "teste@pix" },
  });

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    localStorage.clear();
    Object.defineProperty(window, "mobflowDesktop", {
      configurable: true,
      value: {},
    });
  });

  async function verify() {
    const { verifyDesktopOfflinePreparation } = await import("@/lib/store");
    return verifyDesktopOfflinePreparation(accountId);
  }

  function saveSnapshot(snapshot: unknown, owner = accountId, syncedAt = now.toISOString()) {
    localStorage.setItem("mobflow:owner", owner);
    localStorage.setItem(`mobflow:v1:${accountId}`, JSON.stringify(snapshot));
    localStorage.setItem(`mobflow:last-sync:${accountId}`, syncedAt);
  }

  it("accepts a complete, recent snapshot for the authorized company", async () => {
    saveSnapshot(validSnapshot());
    await expect(verify()).resolves.toMatchObject({ products: 1, syncedAt: now.getTime() });
  });

  it("rejects a snapshot owned by another company", async () => {
    saveSnapshot(validSnapshot(), "company-b");
    await expect(verify()).rejects.toThrow("empresa autorizada");
  });

  it("rejects an empty catalog or missing operational collections", async () => {
    const emptyCatalog = validSnapshot();
    emptyCatalog.products = [];
    saveSnapshot(emptyCatalog);
    await expect(verify()).rejects.toThrow("dados essenciais");

    const missingCashMovements = validSnapshot() as Record<string, unknown>;
    delete missingCashMovements.cashMovements;
    saveSnapshot(missingCashMovements);
    await expect(verify()).rejects.toThrow("dados essenciais");
  });

  it("rejects incomplete catalog entries", async () => {
    const snapshot = validSnapshot();
    snapshot.products[0].name = " ";
    saveSnapshot(snapshot);
    await expect(verify()).rejects.toThrow("produtos incompletos");
  });

  it("rejects missing, stale, and future preparation timestamps", async () => {
    saveSnapshot(validSnapshot(), accountId, "");
    await expect(verify()).rejects.toThrow("preparação local recente");

    saveSnapshot(validSnapshot(), accountId, new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString());
    await expect(verify()).rejects.toThrow("preparação local recente");

    saveSnapshot(validSnapshot(), accountId, new Date(now.getTime() + 120_000).toISOString());
    await expect(verify()).rejects.toThrow("preparação local recente");
  });

  it("requires an active service worker and a cached app shell plus route scripts", async () => {
    const { verifyDesktopOfflineAssets } = await import("@/lib/store");
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { controller: null },
    });
    await expect(verifyDesktopOfflineAssets()).rejects.toThrow("cache offline");

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { controller: {} },
    });
    const cache = {
      match: vi.fn().mockResolvedValue(new Response("<html></html>")),
      keys: vi.fn().mockResolvedValue([new Request(`${window.location.origin}/assets/app.js`)]),
    };
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: { keys: vi.fn().mockResolvedValue(["mobflow-desktop-shell-v1"]), open: vi.fn().mockResolvedValue(cache) },
    });
    await expect(verifyDesktopOfflineAssets()).rejects.toThrow("telas do PDV");

    cache.keys.mockResolvedValue([
      new Request(`${window.location.origin}/assets/app.js`),
      new Request(`${window.location.origin}/assets/route.js`),
    ]);
    await expect(verifyDesktopOfflineAssets()).resolves.toMatchObject({ cachedScripts: 2 });
  });

  it("rejects malformed local JSON and non-desktop execution", async () => {
    localStorage.setItem("mobflow:owner", accountId);
    localStorage.setItem(`mobflow:v1:${accountId}`, "{broken");
    await expect(verify()).rejects.toThrow("arquivo local");

    Object.defineProperty(window, "mobflowDesktop", { configurable: true, value: undefined });
    await expect(verify()).rejects.toThrow("empresa autorizada");
  });
});
