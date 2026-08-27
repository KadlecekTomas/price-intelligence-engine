DROP POLICY IF EXISTS public_read_scan_runs ON public.scan_runs;
DROP POLICY IF EXISTS public_read_products ON public.products;
DROP POLICY IF EXISTS public_read_price_snapshots ON public.price_snapshots;

CREATE POLICY public_read_scan_runs
ON public.scan_runs
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY public_read_products
ON public.products
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY public_read_price_snapshots
ON public.price_snapshots
FOR SELECT
TO anon, authenticated
USING (true);

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.scan_runs, public.products, public.price_snapshots TO anon, authenticated;

CREATE OR REPLACE VIEW public.current_product_search
WITH (security_invoker = true)
AS
WITH latest_runs AS (
  SELECT DISTINCT ON (shop_id, market)
    id,
    shop_id,
    market,
    finished_at
  FROM public.scan_runs
  WHERE finished_at IS NOT NULL AND product_count > 0
  ORDER BY shop_id, market, finished_at DESC
), current_scan AS (
  SELECT
    latest_runs.shop_id,
    latest_runs.market,
    snapshots.product_id,
    snapshots.current_price_czk,
    snapshots.original_price_czk,
    snapshots.lowest_30d_czk,
    snapshots.deal_score,
    snapshots.material_score,
    snapshots.buy_score,
    snapshots.verdict,
    snapshots.captured_at
  FROM public.price_snapshots snapshots
  JOIN latest_runs ON latest_runs.id = snapshots.scan_run_id
), history AS (
  SELECT
    product_id,
    MIN(current_price_czk)::INTEGER AS observed_min_czk,
    MAX(current_price_czk)::INTEGER AS observed_max_czk,
    COUNT(*)::INTEGER AS observation_count
  FROM public.price_snapshots
  GROUP BY product_id
)
SELECT
  product.shop_id,
  product.market,
  product.external_key,
  product.url,
  product.raw_text,
  product.item_number,
  product.material,
  product.fit,
  product.color,
  product.quality_signals,
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
  history.observation_count,
  CASE
    WHEN current_scan.lowest_30d_czk IS NULL OR current_scan.lowest_30d_czk = 0 THEN NULL
    ELSE current_scan.current_price_czk::DOUBLE PRECISION / current_scan.lowest_30d_czk
  END AS ratio_to_low,
  CASE
    WHEN current_scan.original_price_czk IS NULL OR current_scan.original_price_czk = 0 THEN NULL
    ELSE GREATEST(0, 1 - current_scan.current_price_czk::DOUBLE PRECISION / current_scan.original_price_czk)
  END AS discount_pct,
  CASE
    WHEN history.observed_min_czk = 0 THEN NULL
    ELSE current_scan.current_price_czk::DOUBLE PRECISION / history.observed_min_czk
  END AS ratio_to_observed_min,
  CASE
    WHEN history.observation_count < 2 OR history.observed_min_czk = 0 THEN NULL
    ELSE GREATEST(
      0,
      LEAST(
        100,
        100 - ((current_scan.current_price_czk::DOUBLE PRECISION / history.observed_min_czk) - 1) * 100
      )
    )
  END AS history_score,
  CONCAT_WS(
    ' ',
    product.raw_text,
    product.material,
    product.fit,
    product.color,
    product.quality_signals::TEXT
  ) AS search_document
FROM current_scan
JOIN history ON history.product_id = current_scan.product_id
JOIN public.products product ON product.id = current_scan.product_id
WHERE product.shop_id = current_scan.shop_id AND product.market = current_scan.market;

GRANT SELECT ON public.current_product_search TO anon, authenticated;
