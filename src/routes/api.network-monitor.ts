import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/network-monitor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (process.env["VERCEL_ENV"] !== "preview") {
          return Response.json({ ok: false }, { status: 404 });
        }
        const origin = request.headers.get("origin");
        const host = request.headers.get("host");
        if (!origin || !host || new URL(origin).host !== host) {
          return Response.json({ ok: false }, { status: 403 });
        }
        let event: Record<string, unknown> = {};
        try { event = await request.json() as Record<string, unknown>; } catch {
          return Response.json({ ok: false }, { status: 400 });
        }
        const hostName = typeof event.host === "string" ? event.host.slice(0, 180) : "";
        const path = typeof event.path === "string" ? event.path.slice(0, 180) : "";
        const method = typeof event.method === "string" ? event.method.slice(0, 10) : "";
        const status = typeof event.status === "number" ? event.status : null;
        const duration = typeof event.duration_ms === "number" ? Math.max(0, Math.min(120000, Math.round(event.duration_ms))) : 0;
        const kind = event["kind"] === "xhr" ? "xhr" : "fetch";
        if (!hostName || !path.startsWith("/") || !method) {
          return Response.json({ ok: false }, { status: 400 });
        }
        console.info("[MobFlow Network Monitor]", JSON.stringify({
          app: "pdv-preview", host: hostName, path, method, status,
          duration_ms: duration, kind, failed: event["failed"] === true,
        }));
        return Response.json({ ok: true }, { status: 202 });
      },
    },
  },
});
