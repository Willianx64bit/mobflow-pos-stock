const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLocalRuntimeServer, isApiRequest, safeFilePath } = require("../local-runtime.cjs");

async function withServer(options, run) {
  const server = createLocalRuntimeServer(options);
  const address = await server.listen();
  try { await run(address); } finally { await server.close(); }
}

test("routes API and TanStack server-function requests to the fixed remote API origin", () => {
  assert.equal(isApiRequest("/api/mobflow/login"), true);
  assert.equal(isApiRequest("/api/auth/sign-in/email"), true);
  assert.equal(isApiRequest("/_serverFn/abc"), true);
  assert.equal(isApiRequest("/pdv"), false);
});

test("rejects path traversal outside the packaged web directory", async () => {
  const root = path.resolve("/tmp/mobflow-runtime");
  assert.equal(safeFilePath(root, "/_shell.html"), path.join(root, "_shell.html"));
  assert.equal(safeFilePath(root, "/../../outside.txt"), null);
});

test("serves the packaged SPA shell for root and client-side routes without internet", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mobflow-local-runtime-"));
  await fs.writeFile(path.join(root, "_shell.html"), "<!doctype html><html><body>LOCAL MOBFLOW SHELL</body></html>");
  await fs.mkdir(path.join(root, "assets"));
  await fs.writeFile(path.join(root, "assets", "app.js"), "window.mobflowLocal = true;");
  try {
    await withServer({ publicDir: root, remoteOrigin: "https://mobflow-pdv-gestao.vercel.app" }, async ({ url }) => {
      const home = await fetch(url);
      assert.equal(home.status, 200);
      assert.match(await home.text(), /LOCAL MOBFLOW SHELL/);
      const route = await fetch(new URL("/operacoes/baixa-produtos", url));
      assert.equal(route.status, 200);
      assert.match(await route.text(), /LOCAL MOBFLOW SHELL/);
      const asset = await fetch(new URL("/assets/app.js", url));
      assert.equal(asset.status, 200);
      assert.match(await asset.text(), /mobflowLocal/);
      const missingAsset = await fetch(new URL("/assets/missing.js", url));
      assert.equal(missingAsset.status, 404);
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("proxies authenticated API cookies, methods, request bodies and Set-Cookie headers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mobflow-local-proxy-"));
  await fs.writeFile(path.join(root, "_shell.html"), "<html>shell</html>");
  let observed;
  const fetchImpl = async (target, init) => {
    observed = {
      url: String(target),
      method: init.method,
      cookie: init.headers.get("cookie"),
      body: init.body ? await new Response(init.body).text() : "",
    };
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { "content-type": "application/json", "set-cookie": "better-auth.session_token=abc; Path=/; HttpOnly; Secure; SameSite=Lax" },
    });
  };
  try {
    await withServer({ publicDir: root, remoteOrigin: "https://mobflow-pdv-gestao.vercel.app", fetchImpl }, async ({ url }) => {
      const response = await fetch(new URL("/api/mobflow/login?source=desktop", url), {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "better-auth.session_token=old" },
        body: JSON.stringify({ username: "OPERADOR", password: "segredo" }),
      });
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { ok: true });
      assert.match(response.headers.get("set-cookie") || "", /better-auth\.session_token=abc/);
      assert.equal(observed.url, "https://mobflow-pdv-gestao.vercel.app/api/mobflow/login?source=desktop");
      assert.equal(observed.method, "POST");
      assert.equal(observed.cookie, "better-auth.session_token=old");
      assert.deepEqual(JSON.parse(observed.body), { username: "OPERADOR", password: "segredo" });
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("does not allow an HTTP or untrusted upstream origin", () => {
  assert.throws(() => createLocalRuntimeServer({ publicDir: "/tmp", remoteOrigin: "http://example.com" }), /HTTPS/);
});
