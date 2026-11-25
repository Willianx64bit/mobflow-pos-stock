const test = require("node:test");
const assert = require("node:assert/strict");
const { APP_URL, APP_ORIGIN, resolveAppUrl } = require("../app-config.cjs");

test("desktop EXE defaults to the official MobFlow PDV domain", () => {
  assert.equal(APP_URL, "https://mobflow-pdv-gestao.vercel.app/");
  assert.equal(APP_ORIGIN, "https://mobflow-pdv-gestao.vercel.app");
});

test("desktop app URL can be normalized from the official domain", () => {
  assert.equal(resolveAppUrl("https://mobflow-pdv-gestao.vercel.app/path?q=1#x"), "https://mobflow-pdv-gestao.vercel.app/path/");
});

test("desktop app refuses insecure, Preview, or unrelated URLs", () => {
  assert.throws(() => resolveAppUrl("http://mobflow-pdv-gestao.vercel.app"), /HTTPS/);
  assert.throws(() => resolveAppUrl("https://example-preview.vercel.app"), /domínio oficial/);
  assert.throws(() => resolveAppUrl("https://example.com"), /domínio oficial/);
});
