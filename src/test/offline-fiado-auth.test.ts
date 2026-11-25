import { describe, expect, it } from "vitest";
import { isValidOfflineFiadoSession, type CachedOfflinePdvSession } from "@/lib/offline-fiado-auth";

const NOW = Date.parse("2026-11-22T12:00:00.000Z");
const session: CachedOfflinePdvSession = {
  accountId: "tenant-1",
  role: "pdv",
  username: "operador",
  permissions: ["PDV", "Fiado"],
  savedAt: NOW - 60_000,
};

describe("offline fiado authorization", () => {
  it("accepts the same authenticated PDV session for the same company and operator", () => {
    expect(isValidOfflineFiadoSession(session, "tenant-1", "operador", NOW)).toBe(true);
  });

  it("accepts a cached session until its seven-day limit", () => {
    const atLimit = { ...session, savedAt: NOW - 7 * 24 * 60 * 60 * 1000 };
    expect(isValidOfflineFiadoSession(atLimit, "tenant-1", "operador", NOW)).toBe(true);
    expect(isValidOfflineFiadoSession({ ...atLimit, savedAt: atLimit.savedAt - 1 }, "tenant-1", "operador", NOW)).toBe(false);
  });

  it("rejects a different company, operator, role, or missing Fiado permission", () => {
    expect(isValidOfflineFiadoSession(session, "tenant-2", "operador", NOW)).toBe(false);
    expect(isValidOfflineFiadoSession(session, "tenant-1", "outro", NOW)).toBe(false);
    expect(isValidOfflineFiadoSession({ ...session, role: "manager" }, "tenant-1", "operador", NOW)).toBe(false);
    expect(isValidOfflineFiadoSession({ ...session, permissions: ["PDV"] }, "tenant-1", "operador", NOW)).toBe(false);
    expect(isValidOfflineFiadoSession({ ...session, permissions: ["Fiado"] }, "tenant-1", "operador", NOW)).toBe(true);
  });

  it("rejects expired, future-dated and missing sessions", () => {
    expect(isValidOfflineFiadoSession(null, "tenant-1", "operador", NOW)).toBe(false);
    expect(isValidOfflineFiadoSession({ ...session, savedAt: NOW - 7 * 24 * 60 * 60 * 1000 - 1 }, "tenant-1", "operador", NOW)).toBe(false);
    expect(isValidOfflineFiadoSession({ ...session, savedAt: NOW + 60_001 }, "tenant-1", "operador", NOW)).toBe(false);
  });
});
