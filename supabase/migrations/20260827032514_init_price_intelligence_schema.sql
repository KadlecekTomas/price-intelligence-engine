CREATE TABLE IF NOT EXISTS public.scan_runs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  market TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  product_count INTEGER NOT NULL DEFAULT 0 CHECK (product_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.products (
  id BIGSERIAL PRIMARY KEY,
  shop_id TEXT NOT NULL,
  market TEXT NOT NULL,
  external_key TEXT NOT NULL,
  url TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  item_number TEXT,
  material TEXT,
  fit TEXT,
  color TEXT,
  quality_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT products_shop_market_external_key_key UNIQUE (shop_id, market, external_key),
  CONSTRAINT products_quality_signals_is_array CHECK (jsonb_typeof(quality_signals) = 'array')
);

CREATE TABLE IF NOT EXISTS public.price_snapshots (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  scan_run_id TEXT NOT NULL REFERENCES public.scan_runs(id) ON DELETE CASCADE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_price_czk INTEGER NOT NULL CHECK (current_price_czk > 0),
  original_price_czk INTEGER CHECK (original_price_czk IS NULL OR original_price_czk > 0),
  lowest_30d_czk INTEGER CHECK (lowest_30d_czk IS NULL OR lowest_30d_czk > 0),
  deal_score DOUBLE PRECISION CHECK (deal_score IS NULL OR (deal_score >= 0 AND deal_score <= 100)),
  material_score DOUBLE PRECISION CHECK (material_score IS NULL OR (material_score >= 0 AND material_score <= 100)),
  buy_score DOUBLE PRECISION CHECK (buy_score IS NULL OR (buy_score >= 0 AND buy_score <= 100)),
  verdict TEXT NOT NULL,
  CONSTRAINT price_snapshots_product_run_key UNIQUE (product_id, scan_run_id)
);

CREATE INDEX IF NOT EXISTS idx_products_shop_market ON public.products(shop_id, market);
CREATE INDEX IF NOT EXISTS idx_products_item_number ON public.products(shop_id, market, item_number) WHERE item_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_snapshots_product_time ON public.price_snapshots(product_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_buy_score ON public.price_snapshots(buy_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_scan_runs_shop_market_started ON public.scan_runs(shop_id, market, started_at DESC);

ALTER TABLE public.scan_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_snapshots ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.scan_runs IS 'Price-intelligence crawler executions per shop and market.';
COMMENT ON TABLE public.products IS 'Canonical shop-specific products discovered by crawler adapters.';
COMMENT ON TABLE public.price_snapshots IS 'Immutable-ish price observations used to build historical price intelligence.';
