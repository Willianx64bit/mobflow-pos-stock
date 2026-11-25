const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OFFLINE_SESSION_TTL_MS,
  validateOfflineSession,
  isValidOfflineSessionRecord
} = require("../offline-session.cjs");

const now = 1_800_000_000_000;
const validSession = {
  accountId: "tenant-123",
  role: "pdv",
  username: "William",
  permissions: ["PDV", "Gerência", "Validade", "PDV"]
};

test("accepts only PDV sessions and normalizes the cached identity", () => {
  assert.deepEqual(validateOfflineSession(validSession), {
    accountId: "tenant-123",
    role: "pdv",
    username: "William",
    permissions: ["PDV"]
  });
  assert.equal(validateOfflineSession({ ...validSession, role: "manager" }), null);
  assert.equal(validateOfflineSession({ ...validSession, role: "admin" }), null);
  assert.equal(validateOfflineSession({ ...validSession, role: "owner" }), null);
  assert.equal(validateOfflineSession({ ...validSession, permissions: ["Gerência", "Validade"] }), null);
});

test("rejects malformed identity and permission payloads", () => {
  assert.equal(validateOfflineSession(null), null);
  assert.equal(validateOfflineSession({ ...validSession, accountId: " " }), null);
  assert.equal(validateOfflineSession({ ...validSession, username: "" }), null);
  assert.equal(validateOfflineSession({ ...validSession, permissions: "PDV" }), null);
  assert.equal(validateOfflineSession({ ...validSession, permissions: ["PDV", 7] }), null);
  assert.equal(validateOfflineSession({ ...validSession, permissions: [" "] }), null);
});

test("accepts a session until the seven-day expiry boundary", () => {
  assert.equal(isValidOfflineSessionRecord({
    session: validSession,
    savedAt: now - OFFLINE_SESSION_TTL_MS
  }, now), true);
  assert.equal(isValidOfflineSessionRecord({
    session: validSession,
    savedAt: now - OFFLINE_SESSION_TTL_MS - 1
  }, now), false);
});

test("rejects missing timestamps and timestamps too far in the future", () => {
  assert.equal(isValidOfflineSessionRecord({ session: validSession }, now), false);
  assert.equal(isValidOfflineSessionRecord({
    session: validSession,
    savedAt: now + 60_001
  }, now), false);
  assert.equal(isValidOfflineSessionRecord({
    session: validSession,
    savedAt: now + 60_000
  }, now), true);
});


test("accepts a previously authorized PDV session with Operações-only permission", () => {
  const operationsOnly = {
    accountId: "tenant-operations",
    role: "pdv",
    username: "Operador",
    permissions: ["Operações"]
  };
  assert.deepEqual(validateOfflineSession(operationsOnly), operationsOnly);
  assert.equal(isValidOfflineSessionRecord({ session: operationsOnly, savedAt: now }, now), true);
});
