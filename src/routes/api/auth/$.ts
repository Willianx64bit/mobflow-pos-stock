import { createFileRoute } from "@tanstack/react-router";
import { getMobFlowBetterAuth } from "@/lib/server/better-auth";

async function handleAuth(request: Request): Promise<Response> {
  try {
    return await getMobFlowBetterAuth().handler(request);
  } catch (error) {
    console.error("[MobFlow Better Auth] Request unavailable", error instanceof Error ? error.message : "unknown");
    return Response.json(
      { message: "A autenticação Neon ainda não está configurada neste ambiente." },
      { status: 503 },
    );
  }
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request),
    },
  },
});
