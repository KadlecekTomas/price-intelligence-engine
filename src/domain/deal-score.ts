export type DealVerdict =
  | "NO_HISTORY"
  | "NEW_LOW"
  | "TOP"
  | "GOOD"
  | "OK"
  | "EXPENSIVE"
  | "FAKE_SALE";

export type DealScore = {
  score: number | null;
  ratioTo30DayLow: number | null;
  discountVsOriginal: number | null;
  verdict: DealVerdict;
  fakeSale: boolean;
};

export function calculateDealScore(input: {
  currentPrice: number;
  originalPrice?: number | null;
  low30?: number | null;
}): DealScore {
  const { currentPrice, originalPrice = null, low30 = null } = input;
  const discountVsOriginal =
    originalPrice && originalPrice > 0 ? 1 - currentPrice / originalPrice : null;

  if (!low30 || low30 <= 0) {
    return {
      score: null,
      ratioTo30DayLow: null,
      discountVsOriginal,
      verdict: "NO_HISTORY",
      fakeSale: false,
    };
  }

  const ratioTo30DayLow = currentPrice / low30;
  const score = Math.max(0, Math.min(100, 100 - (ratioTo30DayLow - 1) * 80));
  const fakeSale = ratioTo30DayLow > 1.5 && (discountVsOriginal ?? 0) >= 0.1;

  let verdict: DealVerdict;
  if (fakeSale) verdict = "FAKE_SALE";
  else if (ratioTo30DayLow <= 1) verdict = "NEW_LOW";
  else if (ratioTo30DayLow <= 1.05) verdict = "TOP";
  else if (ratioTo30DayLow <= 1.15) verdict = "GOOD";
  else if (ratioTo30DayLow <= 1.3) verdict = "OK";
  else verdict = "EXPENSIVE";

  return { score, ratioTo30DayLow, discountVsOriginal, verdict, fakeSale };
}
