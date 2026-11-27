-- Supports stable keyset pagination for large tenant-scoped product catalogs.
-- The API orders by (name, id) and resumes after the last product ID.
CREATE INDEX IF NOT EXISTS products_tenant_name_id_idx
  ON public.products (tenant_id, name, id);
