import type { ScannedProduct } from "@/lib/discovery-state";

const DEFAULT_SUPABASE_URL = "https://kcyvbaffduyyydwklzrr.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_JWqonrlwOZq03l66HT6Fyg_s26Iwwuw";

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

function publicConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY,
  };
}

export async function readPublicProducts(limit = 500): Promise<ScannedProduct[]> {
  const safeLimit = Math.max(1, Math.min(Math.round(limit), 1000));
  const { url, key } = publicConfig();
  const endpoint = new URL("/rest/v1/current_product_search", url);
  endpoint.searchParams.set("select", "external_key,url,raw_text,item_number,material,fit,color,quality_signals,current_price_czk,original_price_czk,lowest_30d_czk,deal_score,material_score,buy_score,verdict,observed_min_czk,observed_max_czk,observation_count,ratio_to_low,discount_pct,ratio_to_observed_min,history_score");
  endpoint.searchParams.set("market", "eq.CZ");
  endpoint.searchParams.set("order", "buy_score.desc.nullslast,current_price_czk.asc");
  endpoint.searchParams.set("limit", String(safeLimit));

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
    throw new Error(`Supabase public read failed (${response.status}): ${body.slice(0, 180)}`);
  }

  const rows = (await response.json()) as PublicProductRow[];
  return rows.map((row) => ({
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
  }));
}
