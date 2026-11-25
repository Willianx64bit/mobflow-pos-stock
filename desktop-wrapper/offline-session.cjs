const OFFLINE_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_OFFLINE_ROLES = new Set(["pdv"]);

function validateOfflineSession(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { accountId, role, username, permissions } = value;
  if (typeof accountId !== "string" || !accountId.trim() || accountId.length > 128) return null;
  if (!ALLOWED_OFFLINE_ROLES.has(role)) return null;
  if (typeof username !== "string" || !username.trim() || username.length > 120) return null;
  if (!Array.isArray(permissions) || permissions.length > 64 ||
      permissions.some((item) => typeof item !== "string" || !item.trim() || item.length > 80)) return null;
  // Offline mode is intentionally restricted to checkout, Fiado receipts and Operations.
  // A PDV identity must never carry cached Gerência/Admin/other online-only access.
  const offlinePermissions = [...new Set(permissions.map((item) => item.trim())
    .filter((item) => item === "PDV" || item === "Operações" || item === "Fiado"))];
  if (offlinePermissions.length === 0) return null;
  return {
    accountId: accountId.trim(),
    role,
    username: username.trim(),
    permissions: offlinePermissions
  };
}

function isValidOfflineSessionRecord(record, now = Date.now()) {
  if (!record || typeof record !== "object" || !validateOfflineSession(record.session)) return false;
  if (!Number.isFinite(record.savedAt) || !Number.isFinite(now)) return false;
  return now - record.savedAt <= OFFLINE_SESSION_TTL_MS && record.savedAt <= now + 60_000;
}

module.exports = {
  OFFLINE_SESSION_TTL_MS,
  validateOfflineSession,
  isValidOfflineSessionRecord
};
