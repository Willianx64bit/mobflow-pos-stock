import { createFileRoute } from "@tanstack/react-router";
import { beginAuthenticatedTransaction, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

export const Route = createFileRoute("/api/mobflow/session-context")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let transaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
        try {
          transaction = await beginAuthenticatedTransaction(request);
          const { identity } = transaction;
          await releaseTransaction(transaction.client, true);
          transaction = null;

          return Response.json({
            ok: true,
            user: {
              id: identity.userId,
              username: identity.username,
              displayName: identity.displayName,
              role: identity.role,
              permissions: identity.permissions,
            },
            accountId: identity.accountId,
          });
        } catch (error) {
          if (transaction) {
            try {
              await releaseTransaction(transaction.client, false);
            } catch {}
          }
          return jsonError(error);
        }
      },
    },
  },
});
