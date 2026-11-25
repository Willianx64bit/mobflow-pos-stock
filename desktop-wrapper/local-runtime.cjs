const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json; charset=utf-8",
};

function isApiRequest(pathname) {
  return pathname.startsWith("/api/") || pathname.startsWith("/_serverFn/");
}

function safeFilePath(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const relative = decoded.replace(/^\/+/, "");
  const resolved = path.resolve(root, relative || "_shell.html");
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== path.resolve(root, "_shell.html") && !resolved.startsWith(prefix)) return null;
  return resolved;
}

async function proxyRequest(request, response, remoteOrigin, fetchImpl) {
  const incoming = new URL(request.url || "/", "http://127.0.0.1");
  const target = new URL(incoming.pathname + incoming.search, remoteOrigin);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || ["host", "connection", "content-length", "transfer-encoding"].includes(name.toLowerCase())) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }
  // Better Auth validates Origin against the official application host.
  headers.set("origin", remoteOrigin);
  headers.set("referer", remoteOrigin + "/");
  const method = request.method || "GET";
  const init = { method, headers, redirect: "manual" };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }

  const upstream = await fetchImpl(target, init);
  response.statusCode = upstream.status;
  const responseHeaders = {};
  upstream.headers.forEach((value, name) => {
    if (!["set-cookie", "content-length", "content-encoding", "transfer-encoding", "connection"].includes(name.toLowerCase())) {
      responseHeaders[name] = value;
    }
  });
  const cookies = typeof upstream.headers.getSetCookie === "function"
    ? upstream.headers.getSetCookie()
    : (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie")] : []);
  // The renderer runs on the isolated 127.0.0.1 origin, not on the upstream
  // Vercel hostname. Convert upstream domain cookies to host-only local cookies
  // so Chromium can persist and resend the Better Auth session on app restarts.
  const localCookies = cookies.map((cookie) => cookie.replace(/;\s*domain=[^;]*/ig, ""));
  if (localCookies.length) responseHeaders["set-cookie"] = localCookies;
  response.writeHead(upstream.status, responseHeaders);
  if (!upstream.body || method === "HEAD") {
    response.end();
    return;
  }
  Readable.fromWeb(upstream.body).pipe(response);
}

function createLocalRuntimeServer({ publicDir, remoteOrigin, fetchImpl = fetch, logger = console }) {
  const root = path.resolve(publicDir);
  if (!remoteOrigin || new URL(remoteOrigin).protocol !== "https:") {
    throw new Error("O servidor remoto do MobFlow precisa usar HTTPS.");
  }

  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
      if (isApiRequest(pathname)) {
        await proxyRequest(request, response, remoteOrigin, fetchImpl);
        return;
      }

      const requested = pathname === "/" ? "/_shell.html" : pathname;
      let filePath = safeFilePath(root, requested);
      if (!filePath) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
        response.end("Invalid path");
        return;
      }

      let stat = null;
      try { stat = await fs.promises.stat(filePath); } catch {}
      if (!stat?.isFile()) {
        if (path.extname(pathname) || pathname.startsWith("/assets/") || pathname.startsWith("/_build/")) {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
          response.end("Not found");
          return;
        }
        filePath = path.join(root, "_shell.html");
        try { stat = await fs.promises.stat(filePath); } catch {}
      }
      if (!stat?.isFile()) {
        response.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        response.end("MobFlow local runtime is not installed correctly.");
        return;
      }

      const extension = path.extname(filePath).toLowerCase();
      const isHtml = extension === ".html";
      response.writeHead(200, {
        "content-type": MIME_TYPES[extension] || "application/octet-stream",
        "content-length": String(stat.size),
        "cache-control": isHtml ? "no-store" : "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      });
      if (request.method === "HEAD") response.end();
      else fs.createReadStream(filePath).pipe(response);
    } catch (error) {
      logger.error("[MobFlow local runtime]", error);
      if (!response.headersSent) {
        response.writeHead(502, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-mobflow-local-proxy-error": "1",
        });
      }
      response.end(JSON.stringify({ ok: false, error: "Não foi possível acessar o serviço do MobFlow." }));
    }
  });

  return {
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        const onError = (error) => { server.off("listening", onListening); reject(error); };
        const onListening = () => {
          server.off("error", onError);
          const address = server.address();
          if (!address || typeof address === "string") return reject(new Error("Não foi possível reservar uma porta local."));
          resolve({ url: `http://127.0.0.1:${address.port}/`, origin: `http://127.0.0.1:${address.port}`, port: address.port });
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

module.exports = { createLocalRuntimeServer, isApiRequest, safeFilePath };
