export type CachedOfflinePdvSession = {
  accountId: string;
  role: string;
  username: string;
  permissions: string[];
  savedAt: number;
};

const OFFLINE_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function isValidOfflineFiadoSession(
  cached: CachedOfflinePdvSession | null | undefined,
  expectedAccount: string | null,
  expectedUsername: string | null | undefined,
  now = Date.now(),
): boolean {
  return !!cached &&
    cached.role === "pdv" &&
    Array.isArray(cached.permissions) &&
    cached.permissions.includes("Fiado") &&
    !!expectedAccount &&
    cached.accountId === expectedAccount &&
    !!expectedUsername &&
    cached.username === expectedUsername &&
    Number.isFinite(cached.savedAt) &&
    Number.isFinite(now) &&
    now - cached.savedAt <= OFFLINE_SESSION_TTL_MS &&
    cached.savedAt <= now + 60_000;
}
