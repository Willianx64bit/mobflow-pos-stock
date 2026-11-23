const CACHE_NAME = "mobflow-desktop-shell-v1";
const APP_SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(APP_SHELL_URL, { credentials: "same-origin", cache: "reload" });
      if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
        await cache.put(APP_SHELL_URL, response.clone());
        const html = await response.text();
        const assetPaths = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
          .map((match) => match[1])
          .filter((value) => typeof value === "string" && value.startsWith("/") &&
            !value.startsWith("/api/") && /\.(?:m?js|css|woff2?|ttf|svg)(?:\?|$)/i.test(value));
        await Promise.all([...new Set(assetPaths)].map(async (assetPath) => {
          try {
            const assetUrl = new URL(assetPath, self.location.origin);
            if (assetUrl.origin !== self.location.origin) return;
            const assetResponse = await fetch(assetUrl.href, { credentials: "same-origin" });
            if (assetResponse.ok && assetResponse.type === "basic") await cache.put(assetUrl.href, assetResponse);
          } catch {}
        }));
      }
    } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("mobflow-desktop-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated APIs, login/session responses, or user data.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/_server/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && url.pathname === "/" && (response.headers.get("content-type") || "").includes("text/html")) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(APP_SHELL_URL, response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match(APP_SHELL_URL);
        if (cached) return cached;
        return new Response("MobFlow offline shell unavailable. Reconnect and open the app once before using offline mode.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }
    })());
    return;
  }

  if (["script", "style", "image", "font"].includes(request.destination)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    })());
  }
});
