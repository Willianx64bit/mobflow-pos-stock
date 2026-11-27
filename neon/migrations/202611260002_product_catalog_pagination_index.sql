-- Supports stable keyset pagination for large tenant-scoped product catalogs.
-- created_at is immutable during product edits; name is not. Ordering by
-- (created_at, id) prevents renamed products from being skipped or duplicated
-- while a multi-page catalog snapshot is being downloaded.
CREATE INDEX IF NOT EXISTS products_tenant_created_id_idx
  ON public.products (tenant_id, created_at, id);
