import postgres from "postgres";
import type { ScannedProduct } from "@/lib/discovery-state";

const globalDb = globalThis as typeof globalThis & {
  __priceIntelligenceSql?: ReturnType<typeof postgres>;
  __priceIntelligenceSchemaReady?: Promise<void>;
};

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function sqlClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!globalDb.__priceIntelligenceSql) {
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    globalDb.__priceIntelligenceSql = postgres(connectionString, {
      max: 4,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: local ? false : "require",
    });
  }

  return globalDb.__priceIntelligenceSql;
}

async function ensureSchema() {
  if (!globalDb.__priceIntelligenceSchemaReady) {
    globalDb.__priceIntelligenceSchemaReady = (async () => {
      const sql = sqlClient();

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
      await sql`CREATE INDEX IF NOT EXISTS idx_snapshots_product_time ON price_snapshots(product_id, captured_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_snapshots_buy_score ON price_snapshots(buy_score DESC NULLS LAST)`;
    })().catch((error) => {
      globalDb.__priceIntelligenceSchemaReady = undefined;
      throw error;
    });
  }

  return globalDb.__priceIntelligenceSchemaReady;
}

type PersistScanInput = {
  runId: string;
  shopId: string;
  market: string;
  startedAt: string;
  products: ScannedProduct[];
};

export async function persistScanProducts(input: PersistScanInput) {
  if (!databaseConfigured() || input.products.length === 0) return;

  await ensureSchema();
  const sql = sqlClient();

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO scan_runs (id, shop_id, market, started_at, product_count)
      VALUES (${input.runId}, ${input.shopId}, ${input.market}, ${input.startedAt}, ${input.products.length})
      ON CONFLICT (id) DO UPDATE SET
        product_count = EXCLUDED.product_count
    `;

    const productRows = input.products.map((product) => ({
      shop_id: input.shopId,
      market: input.market,
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

    await tx`
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
        "updated_at",
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
    `;

    const persistedProducts = await tx<{ id: string; external_key: string }[]>`
      SELECT id::text, external_key
      FROM products
      WHERE shop_id = ${input.shopId} AND market = ${input.market}
    `;

    const ids = new Map(persistedProducts.map((row) => [row.external_key, row.id]));
    const snapshotRows = input.products
      .map((product) => {
        const productId = ids.get(product.id);
        if (!productId) return null;

        return {
          product_id: productId,
          scan_run_id: input.runId,
          current_price_czk: product.currentPriceCzk,
          original_price_czk: product.originalPriceCzk,
          lowest_30d_czk: product.lowest30dCzk,
          deal_score: product.dealScore,
          material_score: product.materialScore,
          buy_score: product.buyScore,
          verdict: product.verdict,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

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
          "verdict",
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
      SET finished_at = NOW(), product_count = ${snapshotRows.length}
      WHERE id = ${input.runId}
    `;
  });
}

export async function readLatestProducts(limit = 200): Promise<ScannedProduct[]> {
  if (!databaseConfigured()) return [];

  await ensureSchema();
  const sql = sqlClient();
  const safeLimit = Math.max(1, Math.min(limit, 500));

  const rows = await sql<
    Array<{
      external_key: string;
      url: string;
      raw_text: string;
      item_number: string | null;
      material: string | null;
      fit: string | null;
      color: string | null;
      quality_signals: string[] | null;
      current_price_czk: number;
      original_price_czk: number | null;
      lowest_30d_czk: number | null;
      deal_score: number | null;
      material_score: number | null;
      buy_score: number | null;
      verdict: ScannedProduct["verdict"];
    }>
  >`
    WITH latest AS (
      SELECT DISTINCT ON (product_id)
        product_id,
        current_price_czk,
        original_price_czk,
        lowest_30d_czk,
        deal_score,
        material_score,
        buy_score,
        verdict,
        captured_at
      FROM price_snapshots
      ORDER BY product_id, captured_at DESC
    )
    SELECT
      p.external_key,
      p.url,
      p.raw_text,
      p.item_number,
      p.material,
      p.fit,
      p.color,
      p.quality_signals,
      latest.current_price_czk,
      latest.original_price_czk,
      latest.lowest_30d_czk,
      latest.deal_score,
      latest.material_score,
      latest.buy_score,
      latest.verdict
    FROM latest
    JOIN products p ON p.id = latest.product_id
    WHERE p.market = 'CZ'
    ORDER BY COALESCE(latest.buy_score, latest.deal_score, -1) DESC, latest.current_price_czk ASC
    LIMIT ${safeLimit}
  `;

  return rows.map((row) => {
    const ratioToLow = row.lowest_30d_czk
      ? row.current_price_czk / row.lowest_30d_czk
      : null;
    const discountPct = row.original_price_czk
      ? Math.max(0, 1 - row.current_price_czk / row.original_price_czk)
      : null;

    return {
      id: row.external_key,
      url: row.url,
      text: row.raw_text,
      currentPriceCzk: row.current_price_czk,
      originalPriceCzk: row.original_price_czk,
      lowest30dCzk: row.lowest_30d_czk,
      ratioToLow,
      discountPct,
      dealScore: row.deal_score,
      verdict: row.verdict,
      enriched: Boolean(row.material || row.item_number),
      material: row.material,
      fit: row.fit,
      color: row.color,
      itemNumber: row.item_number,
      materialScore: row.material_score,
      buyScore: row.buy_score,
      qualitySignals: row.quality_signals ?? [],
    };
  });
}
