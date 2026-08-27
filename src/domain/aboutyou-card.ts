import type { ScannedProduct } from "@/lib/discovery-state";

export function parseCzk(value: string | undefined | null) {
  if (!value) return null;
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function verdictFromRatio(ratio: number | null): ScannedProduct["verdict"] {
  if (ratio === null) return "NO_HISTORY";
  if (ratio <= 1) return "NEW_LOW";
  if (ratio <= 1.05) return "TOP";
  if (ratio <= 1.15) return "GOOD";
  if (ratio <= 1.3) return "OK";
  return "EXPENSIVE";
}

export function parseAboutYouCard(url: string, rawText: string): ScannedProduct | null {
  const text = rawText.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!text || !/Kč/i.test(text)) return null;

  const originalPriceCzk = parseCzk(
    text.match(/Původně:\s*(?:Od\s*)?([0-9][0-9\s.]*)\s*Kč/i)?.[1],
  );
  const lowest30dCzk = parseCzk(
    text.match(/Poslední nejnižší cena:\s*(?:Od\s*)?([0-9][0-9\s.]*)\s*Kč/i)?.[1],
  );

  // DOM/text order is not guaranteed. Remove labeled reference prices first so
  // an old/30-day price rendered before the current price cannot become the current price.
  const currentPriceText = text
    .replace(/Původně:\s*(?:Od\s*)?[0-9][0-9\s.]*\s*Kč/gi, " ")
    .replace(/Poslední nejnižší cena:\s*(?:Od\s*)?[0-9][0-9\s.]*\s*Kč/gi, " ");
  const priceMatches = [...currentPriceText.matchAll(/(?:Od\s*)?([0-9][0-9\s.]*)\s*Kč/gi)];
  const currentPriceCzk = parseCzk(priceMatches[0]?.[1]);
  if (!currentPriceCzk) return null;

  const ratioToLow = lowest30dCzk ? currentPriceCzk / lowest30dCzk : null;
  const discountPct = originalPriceCzk
    ? Math.max(0, 1 - currentPriceCzk / originalPriceCzk)
    : null;
  const dealScore = ratioToLow === null
    ? null
    : Math.max(0, Math.min(100, 100 - (ratioToLow - 1) * 80));

  return {
    id: url,
    url,
    text,
    currentPriceCzk,
    originalPriceCzk,
    lowest30dCzk,
    ratioToLow,
    discountPct,
    dealScore,
    verdict: verdictFromRatio(ratioToLow),
    enriched: false,
    material: null,
    fit: null,
    color: null,
    itemNumber: null,
    materialScore: null,
    buyScore: dealScore,
    qualitySignals: [],
    observedMinCzk: null,
    observedMaxCzk: null,
    observationCount: 0,
    ratioToObservedMin: null,
    historyScore: null,
  };
}
