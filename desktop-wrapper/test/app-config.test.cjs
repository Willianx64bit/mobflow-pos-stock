const test = require("node:test");
const assert = require("node:assert/strict");
const { APP_URL, APP_ORIGIN, resolveAppUrl } = require("../app-config.cjs");

test("desktop EXE defaults to the isolated Vercel Preview for its own branch", () => {
  assert.equal(APP_URL, "https://mobflow-pos-stock-git-packaging-windows-exe-neon-willianx64bit.vercel.app/");
  assert.equal(APP_ORIGIN, "https://mobflow-pos-stock-git-packaging-windows-exe-neon-willianx64bit.vercel.app");
  assert.notEqual(APP_ORIGIN, "https://mobflow-pdv-gestao.vercel.app");
});

test("desktop app URL can be normalized from a trusted Preview URL", () => {
  assert.equal(resolveAppUrl("https://example-preview.vercel.app/path?q=1#x"), "https://example-preview.vercel.app/path/");
});

test("desktop app refuses insecure or production URLs", () => {
  assert.throws(() => resolveAppUrl("http://example-preview.vercel.app"), /HTTPS/);
  assert.throws(() => resolveAppUrl("https://mobflow-pdv-gestao.vercel.app"), /produção/);
  assert.throws(() => resolveAppUrl("https://example.com"), /Preview Vercel/);
});
