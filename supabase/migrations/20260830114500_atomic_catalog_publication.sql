CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.catalog_run_items (
  scan_run_id TEXT NOT NULL REFERENCES public.scan_runs(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  item_number TEXT,
  material TEXT,
  fit TEXT,
  color TEXT,
  quality_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_price_czk INTEGER NOT NULL,
  original_price_czk INTEGER,
  lowest_30d_czk INTEGER,
  deal_score DOUBLE PRECISION,
  material_score DOUBLE PRECISION,
  buy_score DOUBLE PRECISION,
  verdict TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_document TEXT GENERATED ALWAYS AS (
    lower(
      coalesce(raw_text, '') || ' ' ||
      coalesce(item_number, '') || ' ' ||
      coalesce(material, '') || ' ' ||
      coalesce(fit, '') || ' ' ||
      coalesce(color, '')
    )
  ) STORED,
  PRIMARY KEY (scan_run_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.catalog_publications (
  shop_id TEXT NOT NULL,
  market TEXT NOT NULL,
  active_run_id TEXT NOT NULL REFERENCES public.scan_runs(id) ON DELETE RESTRICT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_id, market)
);

CREATE TABLE IF NOT EXISTS public.price_history (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_price_czk INTEGER NOT NULL,
  original_price_czk INTEGER,
  lowest_30d_czk INTEGER
);

CREATE INDEX IF NOT EXISTS idx_catalog_run_items_run ON public.catalog_run_items(scan_run_id);
CREATE INDEX IF NOT EXISTS idx_catalog_run_items_product ON public.catalog_run_items(product_id);
CREATE INDEX IF NOT EXISTS idx_catalog_run_items_price ON public.catalog_run_items(scan_run_id, current_price_czk);
CREATE INDEX IF NOT EXISTS idx_catalog_run_items_search_trgm
  ON public.catalog_run_items USING GIN (search_document gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_price_history_product_time
  ON public.price_history(product_id, captured_at DESC);

ALTER TABLE public.catalog_run_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_read_catalog_run_items ON public.catalog_run_items;
DROP POLICY IF EXISTS public_read_catalog_publications ON public.catalog_publications;
DROP POLICY IF EXISTS public_read_price_history ON public.price_history;

CREATE POLICY public_read_catalog_run_items
ON public.catalog_run_items
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY public_read_catalog_publications
ON public.catalog_publications
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY public_read_price_history
ON public.price_history
FOR SELECT
TO anon, authenticated
USING (true);

GRANT SELECT ON public.catalog_run_items, public.catalog_publications, public.price_history TO anon, authenticated;

CREATE OR REPLACE VIEW public.current_product_search
WITH (security_invoker = true)
AS
WITH current_scan AS (
  SELECT
    publication.shop_id,
    publication.market,
    item.product_id,
    item.url,
    item.raw_text,
    item.item_number,
    item.material,
    item.fit,
    item.color,
    item.quality_signals,
    item.current_price_czk,
    item.original_price_czk,
    item.lowest_30d_czk,
    item.deal_score,
    item.material_score,
    item.buy_score,
    item.verdict,
    item.captured_at,
    item.search_document
  FROM public.catalog_publications publication
  JOIN public.catalog_run_items item ON item.scan_run_id = publication.active_run_id
), history AS (
  SELECT
    product_id,
    MIN(current_price_czk)::INTEGER AS observed_min_czk,
    MAX(current_price_czk)::INTEGER AS observed_max_czk,
    COUNT(*)::INTEGER AS observation_count
  FROM public.price_history
  GROUP BY product_id
)
SELECT
  product.shop_id,
  product.market,
  product.external_key,
  current_scan.url,
  current_scan.raw_text,
  current_scan.item_number,
  current_scan.material,
  current_scan.fit,
  current_scan.color,
  current_scan.quality_signals,
  current_scan.current_price_czk,
  current_scan.original_price_czk,
  current_scan.lowest_30d_czk,
  current_scan.deal_score,
  current_scan.material_score,
  current_scan.buy_score,
  current_scan.verdict,
  current_scan.captured_at,
  history.observed_min_czk,
  history.observed_max_czk,
  COALESCE(history.observation_count, 0) AS observation_count,
  CASE
    WHEN current_scan.lowest_30d_czk IS NULL OR current_scan.lowest_30d_czk = 0 THEN NULL
    ELSE current_scan.current_price_czk::DOUBLE PRECISION / current_scan.lowest_30d_czk
  END AS ratio_to_low,
  CASE
    WHEN current_scan.original_price_czk IS NULL OR current_scan.original_price_czk = 0 THEN NULL
    ELSE GREATEST(0, 1 - current_scan.current_price_czk::DOUBLE PRECISION / current_scan.original_price_czk)
  END AS discount_pct,
  CASE
    WHEN history.observed_min_czk IS NULL OR history.observed_min_czk = 0 THEN NULL
    ELSE current_scan.current_price_czk::DOUBLE PRECISION / history.observed_min_czk
  END AS ratio_to_observed_min,
  CASE
    WHEN COALESCE(history.observation_count, 0) < 2 OR history.observed_min_czk IS NULL OR history.observed_min_czk = 0 THEN NULL
    ELSE GREATEST(
      0,
      LEAST(
        100,
        100 - ((current_scan.current_price_czk::DOUBLE PRECISION / history.observed_min_czk) - 1) * 100
      )
    )
  END AS history_score,
  current_scan.search_document
FROM current_scan
JOIN public.products product ON product.id = current_scan.product_id
LEFT JOIN history ON history.product_id = current_scan.product_id
WHERE product.shop_id = current_scan.shop_id AND product.market = current_scan.market;

GRANT SELECT ON public.current_product_search TO anon, authenticated;
