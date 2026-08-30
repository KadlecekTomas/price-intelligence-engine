import type { SearchIntent, SearchResult } from "@/domain/natural-search";
import { searchProducts } from "@/domain/natural-search";
import type { ScannedProduct } from "@/lib/discovery-state";

const DEFAULT_SUPABASE_URL = "https://kcyvbaffduyyydwklzrr.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_JWqonrlwOZq03l66HT6Fyg_s26Iwwuw";
const SELECT_COLUMNS = "external_key,url,raw_text,item_number,material,fit,color,quality_signals,current_price_czk,original_price_czk,lowest_30d_czk,deal_score,material_score,buy_score,verdict,observed_min_czk,observed_max_czk,observation_count,ratio_to_low,discount_pct,ratio_to_observed_min,history_score";

type PublicProductRow = {
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
  observed_min_czk: number | null;
  observed_max_czk: number | null;
  observation_count: number | null;
  ratio_to_low: number | null;
  discount_pct: number | null;
  ratio_to_observed_min: number | null;
  history_score: number | null;
};

export type PublicIndexSearchResult = {
  candidates: ScannedProduct[];
  candidateTotal: number;
  indexTotal: number;
  truncated: boolean;
};

function config() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY,
  };
}

function rowToProduct(row: PublicProductRow): ScannedProduct {
  return {
    id: row.external_key,
    url: row.url,
    text: row.raw_text,
    currentPriceCzk: row.current_price_czk,
    originalPriceCzk: row.original_price_czk,
    lowest30dCzk: row.lowest_30d_czk,
    ratioToLow: row.ratio_to_low,
    discountPct: row.discount_pct,
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
    observedMinCzk: row.observed_min_czk,
    observedMaxCzk: row.observed_max_czk,
    observationCount: row.observation_count ?? 0,
    ratioToObservedMin: row.ratio_to_observed_min,
    historyScore: row.history_score,
  };
}

function safeSearchTerm(value: string) {
  return value.replace(/[*,().]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function categoryTerms(intent: SearchIntent) {
  return [...new Set([intent.category, ...intent.categoryTerms].filter((value): value is string => Boolean(value)))]
    .map(safeSearchTerm)
    .filter(Boolean)
    .slice(0, 8);
}

function applyCoarseFilters(endpoint: URL, intent: SearchIntent) {
  endpoint.searchParams.set("market", "eq.CZ");
  endpoint.searchParams.set("shop_id", "eq.aboutyou-cz");
  if (intent.maxPriceCzk !== null) {
    endpoint.searchParams.set("current_price_czk", `lte.${intent.maxPriceCzk}`);
  }

  const categories = categoryTerms(intent);
  if (categories.length > 0) {
    endpoint.searchParams.set(
      "or",
      `(${categories.map((term) => `search_document.ilike.*${term}*`).join(",")})`,
    );
  }

  const required = intent.requiredTerms.map(safeSearchTerm).filter(Boolean).slice(0, 5);
  if (required.length > 0) {
    endpoint.searchParams.set(
      "and",
      `(${required.map((term) => `search_document.ilike.*${term}*`).join(",")})`,
    );
  }
}

function parseTotal(contentRange: string | null) {
  const total = contentRange?.match(/\/(\d+|\*)$/)?.[1];
  return total && total !== "*" ? Number(total) : null;
}

async function fetchRange(
  intent: SearchIntent,
  start: number,
  end: number,
  includeCount: boolean,
): Promise<{ rows: PublicProductRow[]; total: number | null }> {
  const { url, key } = config();
  const endpoint = new URL("/rest/v1/current_product_search", url);
  endpoint.searchParams.set("select", SELECT_COLUMNS);
  endpoint.searchParams.set("order", "buy_score.desc.nullslast,current_price_czk.asc");
  applyCoarseFilters(endpoint, intent);

  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      Prefer: includeCount ? "count=exact" : "count=none",
      Range: `${start}-${end}`,
      "Range-Unit": "items",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Supabase indexed search failed (${response.status}): ${body.slice(0, 180)}`);
  }
  return {
    rows: await response.json() as PublicProductRow[],
    total: parseTotal(response.headers.get("content-range")),
  };
}

async function readIndexTotal() {
  const { url, key } = config();
  const endpoint = new URL("/rest/v1/current_product_search", url);
  endpoint.searchParams.set("select", "external_key");
  endpoint.searchParams.set("market", "eq.CZ");
  endpoint.searchParams.set("shop_id", "eq.aboutyou-cz");
  endpoint.searchParams.set("limit", "1");
  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      Prefer: "count=exact",
      Range: "0-0",
      "Range-Unit": "items",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return 0;
  return parseTotal(response.headers.get("content-range")) ?? 0;
}

export async function readPublicIndexedCandidates(
  intent: SearchIntent,
  options: { maxCandidates?: number; batchSize?: number } = {},
): Promise<PublicIndexSearchResult> {
  const maxCandidates = Math.max(1_000, Math.min(Math.round(options.maxCandidates ?? 25_000), 50_000));
  const batchSize = Math.max(100, Math.min(Math.round(options.batchSize ?? 1_000), 1_000));
  const first = await fetchRange(intent, 0, batchSize - 1, true);
  const candidateTotal = first.total ?? first.rows.length;
  const fetchTarget = Math.min(candidateTotal, maxCandidates);
  const rows = [...first.rows];

  const ranges: Array<[number, number]> = [];
  for (let start = batchSize; start < fetchTarget; start += batchSize) {
    ranges.push([start, Math.min(start + batchSize - 1, fetchTarget - 1)]);
  }

  for (let index = 0; index < ranges.length; index += 4) {
    const group = ranges.slice(index, index + 4);
    const pages = await Promise.all(group.map(([start, end]) => fetchRange(intent, start, end, false)));
    for (const page of pages) rows.push(...page.rows);
  }

  const [indexTotal] = await Promise.all([readIndexTotal()]);
  const unique = new Map<string, ScannedProduct>();
  for (const row of rows) unique.set(row.external_key, rowToProduct(row));

  return {
    candidates: [...unique.values()],
    candidateTotal,
    indexTotal,
    truncated: candidateTotal > maxCandidates,
  };
}

function sortResults(results: SearchResult[], intent: SearchIntent) {
  return results.sort((a, b) => {
    if (intent.sort === "price") return a.product.currentPriceCzk - b.product.currentPriceCzk;
    if (intent.sort === "history") {
      return (b.product.historyScore ?? -1) - (a.product.historyScore ?? -1)
        || b.searchScore - a.searchScore;
    }
    if (intent.sort === "deal") {
      return (b.product.dealScore ?? -1) - (a.product.dealScore ?? -1)
        || b.searchScore - a.searchScore;
    }
    return b.searchScore - a.searchScore || a.product.currentPriceCzk - b.product.currentPriceCzk;
  });
}

export function rankAllIndexedCandidates(products: ScannedProduct[], intent: SearchIntent) {
  const matches: SearchResult[] = [];
  for (const product of products) {
    const result = searchProducts([product], intent, 1)[0];
    if (result) matches.push(result);
  }
  return sortResults(matches, intent);
}
