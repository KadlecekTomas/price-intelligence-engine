import postgres from "postgres";
import type { ScannedProduct } from "@/lib/discovery-state";

const DEFAULT_CHUNK_SIZE = 500;

const globalFullSyncDb = globalThis as typeof globalThis & {
  __priceIntelligenceFullSyncSql?: ReturnType<typeof postgres>;
  __priceIntelligenceFullSyncSchema?: Promise<void>;
};

function client() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for full catalog sync");

  if (!globalFullSyncDb.__priceIntelligenceFullSyncSql) {
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    globalFullSyncDb.__priceIntelligenceFullSyncSql = postgres(connectionString, {
      max: 2,
      idle_timeout: 30,
      connect_timeout: 15,
      ssl: local ? false : "require",
    });
  }
  return globalFullSyncDb.__priceIntelligenceFullSyncSql;
}

async function ensureSchema() {
  if (!globalFullSyncDb.__priceIntelligenceFullSyncSchema) {
    globalFullSyncDb.__priceIntelligenceFullSyncSchema = (async () => {
      const sql = client();
      await sql`
        CREATE TABLE IF NOT EXISTS scan_runs (
          id TEXT PRIMARY KEY,
          shop_id TEXT NOT NULL,
          market TEXT NOT NULL,
          started_at TIMESTAMPTZ NOT NULL,
          finished_at TIMESTAMPTZ,
          product_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS products (
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
          UNIQUE (shop_id, market, external_key)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS price_snapshots (
          id BIGSERIAL PRIMARY KEY,
          product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
          captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          current_price_czk INTEGER NOT NULL,
          original_price_czk INTEGER,
          lowest_30d_czk INTEGER,
          deal_score DOUBLE PRECISION,
          material_score DOUBLE PRECISION,
          buy_score DOUBLE PRECISION,
          verdict TEXT NOT NULL,
          UNIQUE (product_id, scan_run_id)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_products_shop_market ON products(shop_id, market)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_scan_runs_shop_market_finished ON scan_runs(shop_id, market, finished_at DESC) WHERE finished_at IS NOT NULL`;
      await sql`CREATE INDEX IF NOT EXISTS idx_snapshots_scan_run ON price_snapshots(scan_run_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_snapshots_product_time ON price_snapshots(product_id, captured_at DESC)`;
    })().catch((error) => {
      globalFullSyncDb.__priceIntelligenceFullSyncSchema = undefined;
      throw error;
    });
  }
  return globalFullSyncDb.__priceIntelligenceFullSyncSchema;
}

export type FullSyncRun = {
  runId: string;
  shopId: string;
  market: string;
  startedAt: string;
};

export async function beginFullSyncRun(run: FullSyncRun) {
  await ensureSchema();
  const sql = client();
  await sql`
    INSERT INTO scan_runs (id, shop_id, market, started_at, product_count, finished_at)
    VALUES (${run.runId}, ${run.shopId}, ${run.market}, ${run.startedAt}, 0, NULL)
    ON CONFLICT (id) DO UPDATE SET
      product_count = 0,
      finished_at = NULL
  `;
}

async function persistChunk(run: FullSyncRun, products: ScannedProduct[]) {
  if (products.length === 0) return 0;
  const sql = client();

  return sql.begin(async (tx) => {
    const productRows = products.map((product) => ({
      shop_id: run.shopId,
      market: run.market,
      external_key: product.id,
      url: product.url,
      raw_text: product.text,
      item_number: product.itemNumber,
      material: product.material,
      fit: product.fit,
      color: product.color,
      quality_signals: tx.json(product.qualitySignals),
      updated_at: new Date(),
    }));

    const persistedRows = await tx`
      INSERT INTO products ${tx(
        productRows,
        "shop_id",
        "market",
        "external_key",
        "url",
        "raw_text",
        "item_number",
        "material",
        "fit",
        "color",
        "quality_signals",
        "updated_at"
      )}
      ON CONFLICT (shop_id, market, external_key) DO UPDATE SET
        url = EXCLUDED.url,
        raw_text = EXCLUDED.raw_text,
        item_number = COALESCE(EXCLUDED.item_number, products.item_number),
        material = COALESCE(EXCLUDED.material, products.material),
        fit = COALESCE(EXCLUDED.fit, products.fit),
        color = COALESCE(EXCLUDED.color, products.color),
        quality_signals = CASE
          WHEN jsonb_array_length(EXCLUDED.quality_signals) > 0 THEN EXCLUDED.quality_signals
          ELSE products.quality_signals
        END,
        updated_at = NOW()
      RETURNING id::text, external_key
    `;
    const persisted = persistedRows as unknown as Array<{ id: string; external_key: string }>;
    const ids = new Map<string, string>(persisted.map((row) => [row.external_key, row.id]));

    const snapshotRows: Array<{
      product_id: string;
      scan_run_id: string;
      current_price_czk: number;
      original_price_czk: number | null;
      lowest_30d_czk: number | null;
      deal_score: number | null;
      material_score: number | null;
      buy_score: number | null;
      verdict: ScannedProduct["verdict"];
    }> = [];

    for (const product of products) {
      const productId = ids.get(product.id);
      if (!productId) continue;
      snapshotRows.push({
        product_id: productId,
        scan_run_id: run.runId,
        current_price_czk: product.currentPriceCzk,
        original_price_czk: product.originalPriceCzk,
        lowest_30d_czk: product.lowest30dCzk,
        deal_score: product.dealScore,
        material_score: product.materialScore,
        buy_score: product.buyScore,
        verdict: product.verdict,
      });
    }

    if (snapshotRows.length > 0) {
      await tx`
        INSERT INTO price_snapshots ${tx(
          snapshotRows,
          "product_id",
          "scan_run_id",
          "current_price_czk",
          "original_price_czk",
          "lowest_30d_czk",
          "deal_score",
          "material_score",
          "buy_score",
          "verdict"
        )}
        ON CONFLICT (product_id, scan_run_id) DO UPDATE SET
          current_price_czk = EXCLUDED.current_price_czk,
          original_price_czk = EXCLUDED.original_price_czk,
          lowest_30d_czk = EXCLUDED.lowest_30d_czk,
          deal_score = EXCLUDED.deal_score,
          material_score = EXCLUDED.material_score,
          buy_score = EXCLUDED.buy_score,
          verdict = EXCLUDED.verdict,
          captured_at = NOW()
      `;
    }

    await tx`
      UPDATE scan_runs
      SET product_count = (
        SELECT COUNT(*)::INTEGER
        FROM price_snapshots
        WHERE scan_run_id = ${run.runId}
      )
      WHERE id = ${run.runId}
    `;

    return snapshotRows.length;
  });
}

export async function persistFullSyncProducts(
  run: FullSyncRun,
  products: ScannedProduct[],
  chunkSize = DEFAULT_CHUNK_SIZE,
) {
  const size = Math.max(50, Math.min(Math.round(chunkSize), 1000));
  let persisted = 0;
  for (let offset = 0; offset < products.length; offset += size) {
    persisted += await persistChunk(run, products.slice(offset, offset + size));
  }
  return persisted;
}

export async function finishFullSyncRun(runId: string, productCount: number) {
  await ensureSchema();
  const sql = client();
  await sql`
    UPDATE scan_runs
    SET finished_at = NOW(), product_count = ${productCount}
    WHERE id = ${runId}
  `;
}

export async function abandonFullSyncRun(runId: string) {
  await ensureSchema();
  const sql = client();
  await sql`
    UPDATE scan_runs
    SET finished_at = NULL
    WHERE id = ${runId}
  `;
}
