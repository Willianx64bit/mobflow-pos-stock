import { createFileRoute } from "@tanstack/react-router";
import { getNeonPool } from "@/lib/server/neon";

export const Route = createFileRoute("/api/mobflow/billing-settings")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const result = await getNeonPool().query<{
            monthly_price: string | number;
            payment_method: string;
          }>(
            "SELECT monthly_price,payment_method FROM public.admin_billing_settings WHERE id=true LIMIT 1",
          );
          const settings = result.rows[0];
          const monthlyPrice = Number(settings?.monthly_price);
          if (!settings || settings.payment_method !== "pix" || !Number.isFinite(monthlyPrice) || monthlyPrice <= 0) {
            return Response.json({ ok: false, error: "Configuração de cobrança indisponível." }, {
              status: 503,
              headers: { "Cache-Control": "no-store" },
            });
          }
          return Response.json({ ok: true, monthly_price: monthlyPrice, payment_method: "pix" }, {
            headers: { "Cache-Control": "no-store" },
          });
        } catch (error) {
          console.error("[MobFlow billing settings]", error instanceof Error ? error.message : "unknown error");
          return Response.json({ ok: false, error: "Configuração de cobrança indisponível." }, {
            status: 503,
            headers: { "Cache-Control": "no-store" },
          });
        }
      },
    },
  },
});
