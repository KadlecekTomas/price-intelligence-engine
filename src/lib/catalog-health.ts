import { nextCatalogMaintenanceAt } from "@/lib/catalog-schedule";

const DEFAULT_SUPABASE_URL = "https://kcyvbaffduyyydwklzrr.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_JWqonrlwOZq03l66HT6Fyg_s26Iwwuw";

const FULL_SYNC_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const FRESH_PUBLICATION_MS = 30 * 60 * 60 * 1000;

type PublicationRow = {
  shop_id: string;
  market: string;
  active_run_id: string;
  published_at: string;
};

type ScanRunRow = {
  id: string;
  shop_id: string;
  market: string;
  started_at: string;
  finished_at: string | null;
  product_count: number;
  run_kind?: "full_catalog" | "price_refresh";
  status?: "running" | "complete" | "incomplete" | "failed";
  reported_product_count?: number | null;
  coverage?: number | null;
  stop_reason?: string | null;
};

export type CatalogSourceHealth = {
  shopId: string;
  name: string;
  website: string;
  market: string;
  activeRunId: string;
  productCount: number;
  reportedProductCount: number | null;
  partitionCount: number;
  publishedAt: string;
  activeRunStartedAt: string;
  activeRunFinishedAt: string | null;
  latestRunId: string;
  latestRunStartedAt: string;
  latestRunFinishedAt: string | null;
  state: "ready" | "syncing" | "stale" | "attention";
  stateLabel: string;
  coverageLabel: string;
  scheduleLabel: string;
  nextUpdateAt: string | null;
};

export type CatalogHealthSnapshot = {
  generatedAt: string;
  sourceCount: number;
  totalProducts: number;
  lastPublishedAt: string | null;
  nextUpdateAt: string | null;
  sources: CatalogSourceHealth[];
};

const SOURCE_META: Record<string, { name: string; website: string }> = {
  "aboutyou-cz": { name: "ABOUT YOU CZ", website: "aboutyou.cz" },
  "footshop-cz": { name: "Footshop CZ", website: "footshop.cz" },
  "queens-cz": { name: "Queens CZ", website: "queens.cz" },
};

function publicConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY,
  };
}

async function publicGet<T>(table: string, params: Record<string, string>): Promise<T> {
  const { url, key } = publicConfig();
  const endpoint = new URL(`/rest/v1/${table}`, url);
  for (const [name, value] of Object.entries(params)) endpoint.searchParams.set(name, value);

  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Catalog health read failed (${response.status}): ${body.slice(0, 180)}`);
  }

  return response.json() as Promise<T>;
}

async function readScanRuns(params: Record<string, string>) {
  try {
    return await publicGet<ScanRunRow[]>("scan_runs", {
      select: "id,shop_id,market,started_at,finished_at,product_count,run_kind,status,reported_product_count,coverage,stop_reason",
      ...params,
    });
  } catch {
    return publicGet<ScanRunRow[]>("scan_runs", {
      select: "id,shop_id,market,started_at,finished_at,product_count",
      ...params,
    });
  }
}

async function readCompletePartitionCount(activeRunId: string) {
  try {
    const rows = await publicGet<Array<{ partition_key: string }>>("catalog_scan_partitions", {
      select: "partition_key",
      scan_run_id: `eq.${activeRunId}`,
      status: "eq.complete",
      limit: "5000",
    });
    return rows.length;
  } catch {
    return 0;
  }
}

function sourceMeta(shopId: string) {
  return SOURCE_META[shopId] ?? {
    name: shopId,
    website: shopId.replace(/-cz$/, ".cz"),
  };
}

function sourceState(
  publication: PublicationRow,
  latestRun: ScanRunRow,
  now: number,
): Pick<CatalogSourceHealth, "state" | "stateLabel"> {
  if (latestRun.status === "running" || (!latestRun.finished_at && latestRun.id !== publication.active_run_id)) {
    const runAge = now - new Date(latestRun.started_at).getTime();
    if (runAge <= FULL_SYNC_TIMEOUT_MS) return { state: "syncing", stateLabel: "Probíhá aktualizace" };
    return { state: "attention", stateLabel: "Aktualizace překročila limit" };
  }

  if (latestRun.id !== publication.active_run_id && latestRun.status === "failed") {
    return { state: "attention", stateLabel: "Poslední update selhal" };
  }
  if (latestRun.id !== publication.active_run_id && latestRun.status === "incomplete") {
    return { state: "attention", stateLabel: "Poslední update neúplný" };
  }

  const publicationAge = now - new Date(publication.published_at).getTime();
  if (publicationAge > FRESH_PUBLICATION_MS) return { state: "stale", stateLabel: "Full katalog starší než 30 h" };
  return { state: "ready", stateLabel: "Publikováno" };
}

function coverageLabel(run: ScanRunRow) {
  if (typeof run.coverage !== "number" || !run.reported_product_count) return "Neověřeno";
  return `${(run.coverage * 100).toFixed(2)} % · ${run.product_count.toLocaleString("cs-CZ")} / ${run.reported_product_count.toLocaleString("cs-CZ")}`;
}

export async function readCatalogHealth(): Promise<CatalogHealthSnapshot> {
  const publications = await publicGet<PublicationRow[]>("catalog_publications", {
    select: "shop_id,market,active_run_id,published_at",
    order: "shop_id.asc,market.asc",
  });

  const now = Date.now();
  const nowDate = new Date(now);
  const sources = await Promise.all(
    publications.map(async (publication): Promise<CatalogSourceHealth> => {
      const [activeRuns, latestRuns, partitionCount] = await Promise.all([
        readScanRuns({ id: `eq.${publication.active_run_id}`, limit: "1" }),
        readScanRuns({
          shop_id: `eq.${publication.shop_id}`,
          market: `eq.${publication.market}`,
          order: "started_at.desc",
          limit: "1",
        }),
        readCompletePartitionCount(publication.active_run_id),
      ]);

      const activeRun = activeRuns[0];
      if (!activeRun) throw new Error(`Missing active scan run ${publication.active_run_id}`);
      const latestRun = latestRuns[0] ?? activeRun;
      const meta = sourceMeta(publication.shop_id);
      const state = sourceState(publication, latestRun, now);
      const priceRefreshReady = partitionCount > 0;
      const nextUpdateAt = nextCatalogMaintenanceAt(nowDate, priceRefreshReady).toISOString();

      return {
        shopId: publication.shop_id,
        name: meta.name,
        website: meta.website,
        market: publication.market,
        activeRunId: publication.active_run_id,
        productCount: activeRun.product_count,
        reportedProductCount: activeRun.reported_product_count ?? null,
        partitionCount,
        publishedAt: publication.published_at,
        activeRunStartedAt: activeRun.started_at,
        activeRunFinishedAt: activeRun.finished_at,
        latestRunId: latestRun.id,
        latestRunStartedAt: latestRun.started_at,
        latestRunFinishedAt: latestRun.finished_at,
        ...state,
        coverageLabel: coverageLabel(activeRun),
        scheduleLabel: priceRefreshReady
          ? "Ceny každé 4 h · full katalog denně"
          : "Full katalog denně · price refresh čeká na ověřené partitions",
        nextUpdateAt,
      };
    }),
  );

  const lastPublishedAt = sources.reduce<string | null>((latest, source) => {
    if (!latest) return source.publishedAt;
    return new Date(source.publishedAt) > new Date(latest) ? source.publishedAt : latest;
  }, null);
  const nextUpdateAt = sources.reduce<string | null>((earliest, source) => {
    if (!source.nextUpdateAt) return earliest;
    if (!earliest) return source.nextUpdateAt;
    return new Date(source.nextUpdateAt) < new Date(earliest) ? source.nextUpdateAt : earliest;
  }, null);

  return {
    generatedAt: new Date(now).toISOString(),
    sourceCount: sources.length,
    totalProducts: sources.reduce((sum, source) => sum + source.productCount, 0),
    lastPublishedAt,
    nextUpdateAt,
    sources,
  };
}
