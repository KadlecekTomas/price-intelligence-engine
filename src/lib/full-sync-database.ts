import postgres from "postgres";
import type { ScannedProduct } from "@/lib/discovery-state";

const DEFAULT_CHUNK_SIZE = 500;
const PERSIST_RETRY_DELAYS_MS = [750, 1_500, 3_000];

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
      connect_timeout: 20,
      ssl: local ? false : "require",
    });
  }
  return globalFullSyncDb.__priceIntelligenceFullSyncSql;
}

async function ensureSchema() {
  if (!globalFullSyncDb.__priceIntelligenceFullSyncSchema) {
    globalFullSyncDb.__priceIntelligenceFullSyncSchema = (async () => {
      const sql = client();
      await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
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
        CREATE TABLE IF NOT EXISTS catalog_run_items (
          scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
          product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
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
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS catalog_publications (
          shop_id TEXT NOT NULL,
          market TEXT NOT NULL,
          active_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE RESTRICT,
          published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (shop_id, market)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS price_history (
          id BIGSERIAL PRIMARY KEY,
          product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          current_price_czk INTEGER NOT NULL,
          original_price_czk INTEGER,
          lowest_30d_czk INTEGER
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_products_shop_market ON products(shop_id, market)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_scan_runs_shop_market_finished ON scan_runs(shop_id, market, finished_at DESC) WHERE finished_at IS NOT NULL`;
      await sql`CREATE INDEX IF NOT EXISTS idx_catalog_run_items_run ON catalog_run_items(scan_run_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_catalog_run_items_product ON catalog_run_items(product_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_catalog_run_items_price ON catalog_run_items(scan_run_id, current_price_czk)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_catalog_run_items_search_trgm ON catalog_run_items USING GIN (search_document gin_trgm_ops)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_price_history_product_time ON price_history(product_id, captured_at DESC)`;
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
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO scan_runs (id, shop_id, market, started_at, product_count, finished_at)
      VALUES (${run.runId}, ${run.shopId}, ${run.market}, ${run.startedAt}, 0, NULL)
      ON CONFLICT (id) DO UPDATE SET
        shop_id = EXCLUDED.shop_id,
        market = EXCLUDED.market,
        started_at = EXCLUDED.started_at,
        product_count = 0,
        finished_at = NULL
    `;
    await tx`DELETE FROM catalog_run_items WHERE scan_run_id = ${run.runId}`;
  });
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

    const itemRows = products.flatMap((product) => {
      const productId = ids.get(product.id);
      if (!productId) return [];
      return [{
        scan_run_id: run.runId,
        product_id: productId,
        url: product.url,
        raw_text: product.text,
        item_number: product.itemNumber,
        material: product.material,
        fit: product.fit,
        color: product.color,
        quality_signals: tx.json(product.qualitySignals),
        current_price_czk: product.currentPriceCzk,
        original_price_czk: product.originalPriceCzk,
        lowest_30d_czk: product.lowest30dCzk,
        deal_score: product.dealScore,
        material_score: product.materialScore,
        buy_score: product.buyScore,
        verdict: product.verdict,
        captured_at: new Date(),
      }];
    });

    if (itemRows.length > 0) {
      await tx`
        INSERT INTO catalog_run_items ${tx(
          itemRows,
          "scan_run_id",
          "product_id",
          "url",
          "raw_text",
          "item_number",
          "material",
          "fit",
          "color",
          "quality_signals",
          "current_price_czk",
          "original_price_czk",
          "lowest_30d_czk",
          "deal_score",
          "material_score",
          "buy_score",
          "verdict",
          "captured_at"
        )}
        ON CONFLICT (scan_run_id, product_id) DO UPDATE SET
          url = EXCLUDED.url,
          raw_text = EXCLUDED.raw_text,
          item_number = EXCLUDED.item_number,
          material = EXCLUDED.material,
          fit = EXCLUDED.fit,
          color = EXCLUDED.color,
          quality_signals = EXCLUDED.quality_signals,
          current_price_czk = EXCLUDED.current_price_czk,
          original_price_czk = EXCLUDED.original_price_czk,
          lowest_30d_czk = EXCLUDED.lowest_30d_czk,
          deal_score = EXCLUDED.deal_score,
          material_score = EXCLUDED.material_score,
          buy_score = EXCLUDED.buy_score,
          verdict = EXCLUDED.verdict,
          captured_at = EXCLUDED.captured_at
      `;
    }

    await tx`
      UPDATE scan_runs
      SET product_count = (
        SELECT COUNT(*)::INTEGER
        FROM catalog_run_items
        WHERE scan_run_id = ${run.runId}
      )
      WHERE id = ${run.runId}
    `;

    return itemRows.length;
  });
}

async function persistChunkWithRetry(run: FullSyncRun, products: ScannedProduct[]) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= PERSIST_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await persistChunk(run, products);
    } catch (error) {
      lastError = error;
      if (attempt >= PERSIST_RETRY_DELAYS_MS.length) break;
      const delay = PERSIST_RETRY_DELAYS_MS[attempt];
      console.warn(`Catalog DB write failed; retrying in ${delay} ms (${attempt + 1}/${PERSIST_RETRY_DELAYS_MS.length})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export async function persistFullSyncProducts(
  run: FullSyncRun,
  products: ScannedProduct[],
  chunkSize = DEFAULT_CHUNK_SIZE,
) {
  const size = Math.max(50, Math.min(Math.round(chunkSize), 1000));
  let persisted = 0;
  for (let offset = 0; offset < products.length; offset += size) {
    persisted += await persistChunkWithRetry(run, products.slice(offset, offset + size));
  }
  return persisted;
}

export async function finishFullSyncRun(runId: string, expectedProductCount: number) {
  await ensureSchema();
  const sql = client();

  return sql.begin(async (tx) => {
    const runRows = await tx`
      SELECT id, shop_id, market
      FROM scan_runs
      WHERE id = ${runId}
      FOR UPDATE
    ` as unknown as Array<{ id: string; shop_id: string; market: string }>;
    const run = runRows[0];
    if (!run) throw new Error(`Unknown full-sync run ${runId}`);

    const countRows = await tx`
      SELECT COUNT(*)::INTEGER AS count
      FROM catalog_run_items
      WHERE scan_run_id = ${runId}
    ` as unknown as Array<{ count: number }>;
    const actualProductCount = Number(countRows[0]?.count ?? 0);
    if (actualProductCount <= 0) throw new Error("Refusing to publish an empty catalog run");
    if (actualProductCount < expectedProductCount) {
      throw new Error(`Refusing partial publication: expected ${expectedProductCount}, staged ${actualProductCount}`);
    }

    await tx`
      INSERT INTO price_history (
        product_id,
        captured_at,
        current_price_czk,
        original_price_czk,
        lowest_30d_czk
      )
      SELECT
        item.product_id,
        item.captured_at,
        item.current_price_czk,
        item.original_price_czk,
        item.lowest_30d_czk
      FROM catalog_run_items item
      LEFT JOIN LATERAL (
        SELECT
          history.current_price_czk,
          history.original_price_czk,
          history.lowest_30d_czk
        FROM price_history history
        WHERE history.product_id = item.product_id
        ORDER BY history.captured_at DESC, history.id DESC
        LIMIT 1
      ) previous ON true
      WHERE item.scan_run_id = ${runId}
        AND (
          previous.current_price_czk IS NULL
          OR previous.current_price_czk IS DISTINCT FROM item.current_price_czk
          OR previous.original_price_czk IS DISTINCT FROM item.original_price_czk
          OR previous.lowest_30d_czk IS DISTINCT FROM item.lowest_30d_czk
        )
    `;

    await tx`
      UPDATE scan_runs
      SET finished_at = NOW(), product_count = ${actualProductCount}
      WHERE id = ${runId}
    `;

    await tx`
      INSERT INTO catalog_publications (shop_id, market, active_run_id, published_at, updated_at)
      VALUES (${run.shop_id}, ${run.market}, ${runId}, NOW(), NOW())
      ON CONFLICT (shop_id, market) DO UPDATE SET
        active_run_id = EXCLUDED.active_run_id,
        published_at = NOW(),
        updated_at = NOW()
    `;

    await tx`
      DELETE FROM catalog_run_items item
      USING scan_runs old_run
      WHERE item.scan_run_id = old_run.id
        AND old_run.shop_id = ${run.shop_id}
        AND old_run.market = ${run.market}
        AND old_run.id <> ${runId}
    `;

    return actualProductCount;
  });
}

export async function abandonFullSyncRun(runId: string) {
  await ensureSchema();
  const sql = client();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM catalog_run_items WHERE scan_run_id = ${runId}`;
    await tx`
      UPDATE scan_runs
      SET finished_at = NULL, product_count = 0
      WHERE id = ${runId}
    `;
  });
}
