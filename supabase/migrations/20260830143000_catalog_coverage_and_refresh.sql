ALTER TABLE public.scan_runs
  ADD COLUMN IF NOT EXISTS run_kind TEXT NOT NULL DEFAULT 'full_catalog',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'running',
  ADD COLUMN IF NOT EXISTS reported_product_count INTEGER,
  ADD COLUMN IF NOT EXISTS coverage DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS stop_reason TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scan_runs_run_kind_check'
  ) THEN
    ALTER TABLE public.scan_runs
      ADD CONSTRAINT scan_runs_run_kind_check
      CHECK (run_kind IN ('full_catalog', 'price_refresh'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scan_runs_status_check'
  ) THEN
    ALTER TABLE public.scan_runs
      ADD CONSTRAINT scan_runs_status_check
      CHECK (status IN ('running', 'complete', 'incomplete', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scan_runs_coverage_check'
  ) THEN
    ALTER TABLE public.scan_runs
      ADD CONSTRAINT scan_runs_coverage_check
      CHECK (coverage IS NULL OR (coverage >= 0 AND coverage <= 1.25));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.catalog_scan_partitions (
  id BIGSERIAL PRIMARY KEY,
  scan_run_id TEXT NOT NULL REFERENCES public.scan_runs(id) ON DELETE CASCADE,
  partition_key TEXT NOT NULL,
  partition_url TEXT NOT NULL,
  partition_type TEXT NOT NULL,
  expected_count INTEGER,
  discovered_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (scan_run_id, partition_key),
  CONSTRAINT catalog_scan_partitions_status_check
    CHECK (status IN ('pending', 'running', 'complete', 'truncated', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_scan_runs_kind_shop_market_started
  ON public.scan_runs(shop_id, market, run_kind, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_scan_partitions_run_status
  ON public.catalog_scan_partitions(scan_run_id, status);

ALTER TABLE public.catalog_scan_partitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_read_catalog_scan_partitions ON public.catalog_scan_partitions;
CREATE POLICY public_read_catalog_scan_partitions
ON public.catalog_scan_partitions
FOR SELECT
TO anon, authenticated
USING (true);
GRANT SELECT ON public.catalog_scan_partitions TO anon, authenticated;
