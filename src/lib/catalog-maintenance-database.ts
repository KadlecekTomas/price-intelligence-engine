import postgres from "postgres";
import type { AboutYouPartition } from "@/lib/aboutyou-partitions";

const globalMaintenanceDb = globalThis as typeof globalThis & {
  __priceIntelligenceMaintenanceSql?: ReturnType<typeof postgres>;
  __priceIntelligenceMaintenanceSchema?: Promise<void>;
};

function client() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for catalog maintenance");
  if (!globalMaintenanceDb.__priceIntelligenceMaintenanceSql) {
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    globalMaintenanceDb.__priceIntelligenceMaintenanceSql = postgres(connectionString, {
      max: 2,
      idle_timeout: 30,
      connect_timeout: 15,
      ssl: local ? false : "require",
    });
  }
  return globalMaintenanceDb.__priceIntelligenceMaintenanceSql;
}

async function ensureMaintenanceSchema() {
  if (!globalMaintenanceDb.__priceIntelligenceMaintenanceSchema) {
    globalMaintenanceDb.__priceIntelligenceMaintenanceSchema = (async () => {
      const sql = client();
      await sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS run_kind TEXT NOT NULL DEFAULT 'full_catalog'`;
      await sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'running'`;
      await sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS reported_product_count INTEGER`;
      await sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS coverage DOUBLE PRECISION`;
      await sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS stop_reason TEXT`;
      await sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`;
      await sql`
        CREATE TABLE IF NOT EXISTS catalog_scan_partitions (
          id BIGSERIAL PRIMARY KEY,
          scan_run_id TEXT NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
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
          UNIQUE (scan_run_id, partition_key)
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_catalog_scan_partitions_run_status ON catalog_scan_partitions(scan_run_id, status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_scan_runs_kind_shop_market_started ON scan_runs(shop_id, market, run_kind, started_at DESC)`;
    })().catch((error) => {
      globalMaintenanceDb.__priceIntelligenceMaintenanceSchema = undefined;
      throw error;
    });
  }
  return globalMaintenanceDb.__priceIntelligenceMaintenanceSchema;
}

export type PartitionRuntimeStatus = "pending" | "running" | "complete" | "truncated" | "failed";

export async function markRunKind(runId: string, runKind: "full_catalog" | "price_refresh") {
  await ensureMaintenanceSchema();
  const sql = client();
  await sql`
    UPDATE scan_runs
    SET run_kind = ${runKind}, status = 'running', metadata = '{}'::jsonb
    WHERE id = ${runId}
  `;
}

export async function upsertPartitionState(input: {
  runId: string;
  partition: AboutYouPartition;
  status: PartitionRuntimeStatus;
  expectedCount?: number | null;
  discoveredCount?: number;
  error?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await ensureMaintenanceSchema();
  const sql = client();
  const now = new Date();
  const startedAt = input.status === "running" ? now : null;
  const finishedAt = ["complete", "truncated", "failed"].includes(input.status) ? now : null;
  await sql`
    INSERT INTO catalog_scan_partitions (
      scan_run_id, partition_key, partition_url, partition_type,
      expected_count, discovered_count, status, started_at, finished_at, error, metadata
    ) VALUES (
      ${input.runId}, ${input.partition.key}, ${input.partition.url}, ${input.partition.type},
      ${input.expectedCount ?? input.partition.expectedCount}, ${input.discoveredCount ?? 0}, ${input.status},
      ${startedAt}, ${finishedAt}, ${input.error ?? null}, ${sql.json(input.metadata ?? {})}
    )
    ON CONFLICT (scan_run_id, partition_key) DO UPDATE SET
      partition_url = EXCLUDED.partition_url,
      partition_type = EXCLUDED.partition_type,
      expected_count = COALESCE(EXCLUDED.expected_count, catalog_scan_partitions.expected_count),
      discovered_count = EXCLUDED.discovered_count,
      status = EXCLUDED.status,
      started_at = COALESCE(catalog_scan_partitions.started_at, EXCLUDED.started_at),
      finished_at = EXCLUDED.finished_at,
      error = EXCLUDED.error,
      metadata = EXCLUDED.metadata
  `;
}

export async function finalizeCatalogRun(input: {
  runId: string;
  status: "complete" | "incomplete" | "failed";
  reportedProductCount: number | null;
  observedProductCount: number;
  coverage: number | null;
  stopReason: string;
  metadata?: Record<string, unknown>;
  discardStaging?: boolean;
}) {
  await ensureMaintenanceSchema();
  const sql = client();
  await sql.begin(async (tx) => {
    if (input.discardStaging) {
      await tx`DELETE FROM catalog_run_items WHERE scan_run_id = ${input.runId}`;
    }
    await tx`
      UPDATE scan_runs
      SET finished_at = NOW(),
          status = ${input.status},
          product_count = ${input.observedProductCount},
          reported_product_count = ${input.reportedProductCount},
          coverage = ${input.coverage},
          stop_reason = ${input.stopReason},
          metadata = ${tx.json(input.metadata ?? {})}
      WHERE id = ${input.runId}
    `;
  });
}

export async function readActiveCatalogPartitions(shopId: string, market: string) {
  await ensureMaintenanceSchema();
  const sql = client();
  const rows = await sql`
    SELECT
      partition_key,
      partition_url,
      partition_type,
      expected_count,
      discovered_count
    FROM catalog_scan_partitions partition
    JOIN catalog_publications publication ON publication.active_run_id = partition.scan_run_id
    WHERE publication.shop_id = ${shopId}
      AND publication.market = ${market}
      AND partition.status = 'complete'
    ORDER BY partition.partition_key
  ` as unknown as Array<{
    partition_key: string;
    partition_url: string;
    partition_type: "category" | "brand";
    expected_count: number | null;
    discovered_count: number;
  }>;

  return rows.map((row): AboutYouPartition => ({
    key: row.partition_key,
    url: row.partition_url,
    type: row.partition_type,
    parentKey: null,
    depth: new URL(row.partition_url).pathname.split("/").filter(Boolean).length,
    expectedCount: row.expected_count,
  }));
}

export async function finishPriceRefreshRun(runId: string) {
  await ensureMaintenanceSchema();
  const sql = client();
  return sql.begin(async (tx) => {
    const runRows = await tx`
      SELECT id, shop_id, market
      FROM scan_runs
      WHERE id = ${runId}
      FOR UPDATE
    ` as unknown as Array<{ id: string; shop_id: string; market: string }>;
    const run = runRows[0];
    if (!run) throw new Error(`Unknown price refresh run ${runId}`);

    const publicationRows = await tx`
      SELECT active_run_id
      FROM catalog_publications
      WHERE shop_id = ${run.shop_id} AND market = ${run.market}
      FOR UPDATE
    ` as unknown as Array<{ active_run_id: string }>;
    const activeRunId = publicationRows[0]?.active_run_id;
    if (!activeRunId) throw new Error("No active catalog publication available for price refresh");

    const matchedRows = await tx`
      SELECT COUNT(*)::INTEGER AS count
      FROM catalog_run_items refresh
      JOIN catalog_run_items active
        ON active.scan_run_id = ${activeRunId}
       AND active.product_id = refresh.product_id
      WHERE refresh.scan_run_id = ${runId}
    ` as unknown as Array<{ count: number }>;
    const matched = Number(matchedRows[0]?.count ?? 0);
    if (matched <= 0) throw new Error("Price refresh did not match any active catalog products");

    await tx`
      INSERT INTO price_history (product_id, captured_at, current_price_czk, original_price_czk, lowest_30d_czk)
      SELECT
        refresh.product_id,
        refresh.captured_at,
        refresh.current_price_czk,
        refresh.original_price_czk,
        refresh.lowest_30d_czk
      FROM catalog_run_items refresh
      JOIN catalog_run_items active
        ON active.scan_run_id = ${activeRunId}
       AND active.product_id = refresh.product_id
      LEFT JOIN LATERAL (
        SELECT history.current_price_czk, history.original_price_czk, history.lowest_30d_czk
        FROM price_history history
        WHERE history.product_id = refresh.product_id
        ORDER BY history.captured_at DESC, history.id DESC
        LIMIT 1
      ) previous ON true
      WHERE refresh.scan_run_id = ${runId}
        AND (
          previous.current_price_czk IS NULL
          OR previous.current_price_czk IS DISTINCT FROM refresh.current_price_czk
          OR previous.original_price_czk IS DISTINCT FROM refresh.original_price_czk
          OR previous.lowest_30d_czk IS DISTINCT FROM refresh.lowest_30d_czk
        )
    `;

    const changedRows = await tx`
      SELECT COUNT(*)::INTEGER AS count
      FROM catalog_run_items refresh
      JOIN catalog_run_items active
        ON active.scan_run_id = ${activeRunId}
       AND active.product_id = refresh.product_id
      WHERE refresh.scan_run_id = ${runId}
        AND (
          active.current_price_czk IS DISTINCT FROM refresh.current_price_czk
          OR active.original_price_czk IS DISTINCT FROM refresh.original_price_czk
          OR active.lowest_30d_czk IS DISTINCT FROM refresh.lowest_30d_czk
        )
    ` as unknown as Array<{ count: number }>;
    const changed = Number(changedRows[0]?.count ?? 0);

    await tx`
      UPDATE catalog_run_items active
      SET current_price_czk = refresh.current_price_czk,
          original_price_czk = refresh.original_price_czk,
          lowest_30d_czk = refresh.lowest_30d_czk,
          raw_text = refresh.raw_text,
          deal_score = refresh.deal_score,
          buy_score = refresh.buy_score,
          verdict = refresh.verdict,
          captured_at = refresh.captured_at
      FROM catalog_run_items refresh
      WHERE active.scan_run_id = ${activeRunId}
        AND refresh.scan_run_id = ${runId}
        AND active.product_id = refresh.product_id
    `;

    await tx`DELETE FROM catalog_run_items WHERE scan_run_id = ${runId}`;
    await tx`
      UPDATE scan_runs
      SET run_kind = 'price_refresh', status = 'complete', finished_at = NOW(), product_count = ${matched}
      WHERE id = ${runId}
    `;

    return { activeRunId, matched, changed };
  });
}
