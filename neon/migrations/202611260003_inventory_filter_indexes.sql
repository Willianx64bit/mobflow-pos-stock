-- Accelerates server-side inventory filters for large catalogs without
-- moving the complete product list into the browser.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON public.products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_code_trgm_idx
  ON public.products USING gin (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_category_trgm_idx
  ON public.products USING gin (category gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_reference_trgm_idx
  ON public.products USING gin (reference gin_trgm_ops);
CREATE INDEX IF NOT EXISTS product_barcodes_barcode_trgm_idx
  ON public.product_barcodes USING gin (barcode gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_tenant_low_stock_idx
  ON public.products (tenant_id) WHERE stock <= min_stock;
CREATE INDEX IF NOT EXISTS products_tenant_zero_stock_idx
  ON public.products (tenant_id) WHERE stock = 0;
