import { createFileRoute } from "@tanstack/react-router";
import { Buffer } from "node:buffer";
import { beginAuthenticatedTransaction, ApiAuthError, jsonError } from "@/lib/server/mobflow-auth";
import { releaseTransaction } from "@/lib/server/neon";

type CursorPosition = { createdAt: string; id: string };
class InventoryApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
const fail = (message: string, status = 400, code = "invalid_inventory_query"): never => {
  throw new InventoryApiError(message, status, code);
};
function decodeCursor(cursor: string): CursorPosition | null {
  if (!cursor.startsWith("v2.")) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor.slice(3), "base64url").toString("utf8"));
    if (!value || typeof value.createdAt !== "string" || typeof value.id !== "string" ||
        !value.id || !Number.isFinite(Date.parse(value.createdAt))) {
      fail("Cursor de paginação inválido.", 400, "invalid_inventory_cursor");
    }
    return { createdAt: value.createdAt, id: value.id };
  } catch (error) {
    if (error instanceof InventoryApiError) throw error;
    fail("Cursor de paginação inválido.", 400, "invalid_inventory_cursor");
  }
}
function encodeCursor(row: { created_at: string; id: string }): string {
  if (!Number.isFinite(Date.parse(row.created_at)) || !row.id) {
    fail("Não foi possível criar o cursor da listagem.", 500, "invalid_inventory_cursor");
  }
  return "v2." + Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id }), "utf8").toString("base64url");
}
function errorResponse(error: unknown) {
  if (error instanceof InventoryApiError) {
    return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ApiAuthError) return jsonError(error);
  return jsonError(error);
}
async function getInventory(request: Request) {
  if (process.env["MOBFLOW_AUTH_PROVIDER"] !== "better-auth") {
    return Response.json({ ok: false, error: "O catálogo Neon ainda não está habilitado neste ambiente.", code: "catalog_provider_disabled" }, { status: 503 });
  }
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit") ?? "100";
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) {
    return Response.json({ ok: false, error: "Limite inválido.", code: "invalid_inventory_query" }, { status: 400 });
  }
  const limit = Math.min(Number(rawLimit), 100);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const category = (url.searchParams.get("category") ?? "").trim().slice(0, 100);
  const active = url.searchParams.get("active") ?? "all";
  const stock = url.searchParams.get("stock") ?? "all";
  const cursor = url.searchParams.get("cursor");
  if (!["all", "active", "inactive"].includes(active) ||
      !["all", "low", "zero", "positive"].includes(stock) ||
      (cursor !== null && cursor.length > 160)) {
    return Response.json({ ok: false, error: "Filtro inválido.", code: "invalid_inventory_query" }, { status: 400 });
  }

  let transaction: Awaited<ReturnType<typeof beginAuthenticatedTransaction>> | null = null;
  try {
    transaction = await beginAuthenticatedTransaction(request);
    const { client, identity } = transaction;
    const isManager = identity.role === "manager" ||
      (Array.isArray(identity.permissions) && identity.permissions.includes("Gerência"));
    if (!isManager) fail("Somente a Gerência pode consultar o inventário completo.", 403, "permission_denied");

    let position: CursorPosition | null = cursor ? decodeCursor(cursor) : null;
    if (cursor && !position) {
      const legacy = await client.query(
        "SELECT created_at::text AS created_at,id FROM public.products WHERE tenant_id=$1 AND id=$2",
        [identity.accountId, cursor],
      );
      if (!legacy.rows.length) fail("O cursor salvo não existe mais. Atualize a listagem.", 409, "stale_inventory_cursor");
      position = { createdAt: String(legacy.rows[0].created_at), id: String(legacy.rows[0].id) };
    }

    // The global aggregate is needed on the first page and after filter changes,
    // not on every subsequent page of a long inventory browse.
    const summaryResult = cursor === null
      ? await client.query(
          "SELECT COUNT(*)::text AS total, " +
          "COUNT(*) FILTER (WHERE active=true)::text AS active, " +
          "COUNT(*) FILTER (WHERE active=false)::text AS inactive, " +
          "COUNT(*) FILTER (WHERE stock<=min_stock)::text AS low_stock, " +
          "COALESCE(SUM(price*GREATEST(stock,0)),0)::text AS inventory_value " +
          "FROM public.products WHERE tenant_id=$1",
          [identity.accountId],
        )
      : { rows: [] };

    const result = await client.query(
      "SELECT p.id,p.code,p.name,p.reference,p.unit,p.price::text,p.stock::text,p.min_stock::text," +
      "p.category,p.photo_object_key,p.active,p.version::text,p.created_at::text AS created_at," +
      "COALESCE(array_agg(b.barcode) FILTER (WHERE b.barcode IS NOT NULL),ARRAY[]::text[]) AS barcodes " +
      "FROM public.products p LEFT JOIN public.product_barcodes b " +
      "ON b.tenant_id=p.tenant_id AND b.product_id=p.id " +
      "WHERE p.tenant_id=$1 " +
      "AND ($2::text='all' OR p.active=($2::text='active')) " +
      "AND ($3::text='' OR p.name ILIKE '%'||$3||'%' OR p.code ILIKE '%'||$3||'%' " +
      "OR p.reference ILIKE '%'||$3||'%' OR p.category ILIKE '%'||$3||'%' " +
      "OR EXISTS (SELECT 1 FROM public.product_barcodes bx WHERE bx.tenant_id=p.tenant_id " +
      "AND bx.product_id=p.id AND bx.barcode ILIKE '%'||$3||'%')) " +
      "AND ($4::text='' OR p.category ILIKE '%'||$4||'%') " +
      "AND ($5::text='all' OR ($5::text='low' AND p.stock<=p.min_stock) " +
      "OR ($5::text='zero' AND p.stock=0) OR ($5::text='positive' AND p.stock>0)) " +
      "AND ($6::timestamptz IS NULL OR (p.created_at,p.id)>($6::timestamptz,$7::text)) " +
      "GROUP BY p.tenant_id,p.id ORDER BY p.created_at,p.id LIMIT $8",
      [identity.accountId, active, q, category, stock, position?.createdAt ?? null, position?.id ?? null, limit + 1],
    );

    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    const products = rows.map((row: Record<string, unknown>) => ({
      id: String(row.id), code: String(row.code ?? ""), name: String(row.name ?? ""),
      ref: typeof row.reference === "string" ? row.reference : undefined,
      unit: row.unit === "kg" ? "kg" : "un", price: Number(row.price ?? 0),
      stock: Number(row.stock ?? 0), minStock: Number(row.min_stock ?? 0),
      category: String(row.category ?? ""), active: row.active !== false,
      version: Number(row.version ?? 1),
      photoObjectKey: typeof row.photo_object_key === "string" ? row.photo_object_key : undefined,
      barcodes: Array.isArray(row.barcodes) ? row.barcodes.map(String) : [],
    }));
    const summary = summaryResult.rows[0] ?? {};
    await releaseTransaction(client, true);
    transaction = null;
    return Response.json({
      ok: true,
      products,
      hasMore,
      nextCursor: hasMore ? encodeCursor(rows[rows.length - 1] as { created_at: string; id: string }) : null,
      summary: summaryResult.rows.length ? {
        total: Number(summary.total ?? 0),
        active: Number(summary.active ?? 0),
        inactive: Number(summary.inactive ?? 0),
        lowStock: Number(summary.low_stock ?? 0),
        inventoryValue: Number(summary.inventory_value ?? 0),
      } : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (transaction) await releaseTransaction(transaction.client, false).catch(() => undefined);
    return errorResponse(error);
  }
}
export const Route = createFileRoute("/api/mobflow/products/inventory")({
  server: { handlers: { GET: ({ request }) => getInventory(request) } },
});
