import { createFileRoute } from "@tanstack/react-router";
import { beginAuthenticatedTransaction, ApiAuthError, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

class ProductDetailsApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
async function getProductDetails(request: Request) {
  if (process.env["MOBFLOW_AUTH_PROVIDER"] !== "better-auth") {
    return Response.json({ ok: false, error: "O catálogo Neon ainda não está habilitado neste ambiente.", code: "catalog_provider_disabled" }, { status: 503 });
  }
  const productId = new URL(request.url).searchParams.get("productId")?.trim() ?? "";
  const includeSales = new URL(request.url).searchParams.get("includeSales") !== "0";
  if (!productId || productId.length > 160) {
    return Response.json({ ok: false, error: "Produto inválido.", code: "invalid_product_id" }, { status: 400 });
  }
  let transaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
  try {
    transaction = await beginAuthenticatedTransaction(request);
    const { client, identity } = transaction;
    const isManager = identity.role === "manager" ||
      (Array.isArray(identity.permissions) && identity.permissions.includes("Gerência"));
    if (!isManager) throw new ProductDetailsApiError("Somente a Gerência pode consultar custos e totais de vendas.", 403, "permission_denied");
    if (!includeSales) {
      const costResult = await client.query(
        "SELECT cost::text AS cost FROM public.products WHERE tenant_id=$1 AND id=$2",
        [identity.accountId, productId],
      );
      if (!costResult.rows.length) throw new ProductDetailsApiError("Produto não encontrado nesta empresa.", 404, "product_not_found");
      const cost = Number(costResult.rows[0].cost ?? 0);
      await releaseTransaction(client, true);
      transaction = null;
      return Response.json({ ok: true, cost }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await client.query(
      "SELECT p.cost::text AS cost, " +
      "COALESCE(SUM(si.quantity) FILTER (WHERE s.id IS NOT NULL),0)::text AS units_sold, " +
      "COUNT(DISTINCT s.id)::text AS sales_count, " +
      "COALESCE(SUM(si.line_total) FILTER (WHERE s.id IS NOT NULL),0)::text AS revenue, " +
      "COALESCE(SUM(si.line_cost) FILTER (WHERE s.id IS NOT NULL),0)::text AS cost_total, " +
      "COALESCE(SUM(si.line_total-si.line_cost) FILTER (WHERE s.id IS NOT NULL),0)::text AS gross_profit " +
      "FROM public.products p " +
      "LEFT JOIN public.sale_items si ON si.tenant_id=p.tenant_id AND si.product_id=p.id " +
      "LEFT JOIN public.sales s ON s.tenant_id=si.tenant_id AND s.id=si.sale_id AND s.status='completed' " +
      "WHERE p.tenant_id=$1 AND p.id=$2 GROUP BY p.tenant_id,p.id",
      [identity.accountId, productId],
    );
    if (!result.rows.length) throw new ProductDetailsApiError("Produto não encontrado nesta empresa.", 404, "product_not_found");
    const row = result.rows[0];
    await releaseTransaction(client, true);
    transaction = null;
    return Response.json({
      ok: true,
      details: {
        cost: Number(row.cost ?? 0),
        unitsSold: Number(row.units_sold ?? 0),
        salesCount: Number(row.sales_count ?? 0),
        revenue: Number(row.revenue ?? 0),
        costTotal: Number(row.cost_total ?? 0),
        grossProfit: Number(row.gross_profit ?? 0),
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (transaction) await releaseTransaction(transaction.client, false).catch(() => undefined);
    if (error instanceof ProductDetailsApiError) {
      return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof ApiAuthError) return jsonError(error);
    return jsonError(error);
  }
}
export const Route = createFileRoute("/api/mobflow/products/details")({
  server: { handlers: { GET: ({ request }) => getProductDetails(request) } },
});
