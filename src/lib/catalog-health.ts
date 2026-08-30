const DEFAULT_SUPABASE_URL = "https://kcyvbaffduyyydwklzrr.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_JWqonrlwOZq03l66HT6Fyg_s26Iwwuw";

const FULL_SYNC_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const FRESH_PUBLICATION_MS = 24 * 60 * 60 * 1000;

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
};

export type CatalogSourceHealth = {
  shopId: string;
  name: string;
  website: string;
  market: string;
  activeRunId: string;
  productCount: number;
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
  if (!latestRun.finished_at && latestRun.id !== publication.active_run_id) {
    const runAge = now - new Date(latestRun.started_at).getTime();
    if (runAge <= FULL_SYNC_TIMEOUT_MS) {
      return { state: "syncing", stateLabel: "Probíhá aktualizace" };
    }
    return { state: "attention", stateLabel: "Poslední pokus nedokončen" };
  }

  const publicationAge = now - new Date(publication.published_at).getTime();
  if (publicationAge > FRESH_PUBLICATION_MS) {
    return { state: "stale", stateLabel: "Data starší než 24 h" };
  }

  return { state: "ready", stateLabel: "Publikováno" };
}

export async function readCatalogHealth(): Promise<CatalogHealthSnapshot> {
  const publications = await publicGet<PublicationRow[]>("catalog_publications", {
    select: "shop_id,market,active_run_id,published_at",
    order: "shop_id.asc,market.asc",
  });

  const now = Date.now();
  const sources = await Promise.all(
    publications.map(async (publication): Promise<CatalogSourceHealth> => {
      const [activeRuns, latestRuns] = await Promise.all([
        publicGet<ScanRunRow[]>("scan_runs", {
          select: "id,shop_id,market,started_at,finished_at,product_count",
          id: `eq.${publication.active_run_id}`,
          limit: "1",
        }),
        publicGet<ScanRunRow[]>("scan_runs", {
          select: "id,shop_id,market,started_at,finished_at,product_count",
          shop_id: `eq.${publication.shop_id}`,
          market: `eq.${publication.market}`,
          order: "started_at.desc",
          limit: "1",
        }),
      ]);

      const activeRun = activeRuns[0];
      if (!activeRun) throw new Error(`Missing active scan run ${publication.active_run_id}`);
      const latestRun = latestRuns[0] ?? activeRun;
      const meta = sourceMeta(publication.shop_id);
      const state = sourceState(publication, latestRun, now);

      return {
        shopId: publication.shop_id,
        name: meta.name,
        website: meta.website,
        market: publication.market,
        activeRunId: publication.active_run_id,
        productCount: activeRun.product_count,
        publishedAt: publication.published_at,
        activeRunStartedAt: activeRun.started_at,
        activeRunFinishedAt: activeRun.finished_at,
        latestRunId: latestRun.id,
        latestRunStartedAt: latestRun.started_at,
        latestRunFinishedAt: latestRun.finished_at,
        ...state,
        coverageLabel: "Neověřeno",
        scheduleLabel: "Ruční spuštění",
        nextUpdateAt: null,
      };
    }),
  );

  const lastPublishedAt = sources.reduce<string | null>((latest, source) => {
    if (!latest) return source.publishedAt;
    return new Date(source.publishedAt) > new Date(latest) ? source.publishedAt : latest;
  }, null);

  return {
    generatedAt: new Date(now).toISOString(),
    sourceCount: sources.length,
    totalProducts: sources.reduce((sum, source) => sum + source.productCount, 0),
    lastPublishedAt,
    sources,
  };
}
