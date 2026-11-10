type NetworkEvent = {
  host: string;
  path: string;
  method: string;
  status: number | null;
  duration_ms: number;
  kind: "fetch" | "xhr";
  failed?: boolean;
};

declare global {
  interface Window { __mobflowNetworkMonitorInstalled?: boolean }
}

if (typeof window !== "undefined" && !window.__mobflowNetworkMonitorInstalled) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("__mfnet") === "1") {
    try { sessionStorage.setItem("__mfnet_enabled", "1"); } catch { /* storage may be unavailable */ }
  }
  if (params.get("__mfnet") === "0") {
    try { sessionStorage.removeItem("__mfnet_enabled"); } catch { /* ignore */ }
  }

  let enabled = false;
  try { enabled = sessionStorage.getItem("__mfnet_enabled") === "1"; } catch { /* ignore */ }
  if (enabled && window.location.hostname.endsWith(".vercel.app")) {
    window.__mobflowNetworkMonitorInstalled = true;
    const originalFetch = window.fetch.bind(window);
    const report = (event: NetworkEvent) => {
      const payload = JSON.stringify(event);
      void originalFetch("/api/network-monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => undefined);
    };
    const describe = (input: RequestInfo | URL, method: string, status: number | null, started: number, kind: NetworkEvent["kind"], failed = false) => {
      try {
        const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
        const url = new URL(raw, window.location.href);
        if (url.pathname === "/api/network-monitor") return;
        report({
          host: url.host,
          path: url.pathname.slice(0, 180),
          method: method.toUpperCase().slice(0, 10),
          status,
          duration_ms: Math.min(120000, Math.max(0, Math.round(performance.now() - started))),
          kind,
          ...(failed ? { failed: true } : {}),
        });
      } catch { /* never interfere with application requests */ }
    };

    window.fetch = async (input, init) => {
      const started = performance.now();
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      try {
        const response = await originalFetch(input, init);
        describe(input, method, response.status, started, "fetch");
        return response;
      } catch (error) {
        describe(input, method, null, started, "fetch", true);
        throw error;
      }
    };

    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: unknown[]) {
      (this as XMLHttpRequest & { __mfnet?: { method: string; url: string } }).__mfnet = { method, url: String(url) };
      return xhrOpen.call(this, method, url, ...(rest as [boolean?, string?, string?]));
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function(...args: [Document | XMLHttpRequestBodyInit | null] ) {
      const xhr = this as XMLHttpRequest & { __mfnet?: { method: string; url: string } };
      const started = performance.now();
      this.addEventListener("loadend", () => {
        if (xhr.__mfnet) describe(xhr.__mfnet.url, xhr.__mfnet.method, this.status || null, started, "xhr", this.status === 0);
      }, { once: true });
      return xhrSend.apply(this, args);
    };
    console.info("[MobFlow Network Monitor] ativo neste Preview. Nenhum corpo, cookie ou token é registrado.");
  }
}
