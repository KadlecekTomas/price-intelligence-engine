-- Optimize current-catalog reads while keeping all historical snapshots.

CREATE INDEX IF NOT EXISTS idx_scan_runs_shop_market_finished
  ON scan_runs(shop_id, market, finished_at DESC)
  WHERE finished_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_snapshots_scan_run
  ON price_snapshots(scan_run_id);
