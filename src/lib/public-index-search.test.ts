import assert from "node:assert/strict";
import test from "node:test";
import { parseNaturalSearch } from "@/domain/natural-search";
import type { ScannedProduct } from "@/lib/discovery-state";
import { rankAllIndexedCandidates } from "@/lib/public-index-search";

function product(index: number): ScannedProduct {
  return {
    id: `shoe-${index}`,
    url: `https://www.aboutyou.cz/p/test/shoe-${index}`,
    text: `TEST Tenisky model ${index} Dostupné velikosti: 42, 43, 44 ${500 + (index % 400)} Kč`,
    currentPriceCzk: 500 + (index % 400),
    originalPriceCzk: 1200,
    lowest30dCzk: 550,
    ratioToLow: 1,
    discountPct: 0.5,
    dealScore: 90,
    verdict: "TOP",
    enriched: false,
    material: null,
    fit: null,
    color: null,
    itemNumber: null,
    materialScore: null,
    buyScore: 90,
    qualitySignals: [],
    observedMinCzk: null,
    observedMaxCzk: null,
    observationCount: 0,
    ratioToObservedMin: null,
    historyScore: null,
  };
}

test("keeps more than 100 matching indexed products before API pagination", () => {
  const intent = parseNaturalSearch("tenisky velikost 43 do 1000 Kč");
  const products = Array.from({ length: 150 }, (_, index) => product(index));
  const results = rankAllIndexedCandidates(products, intent);

  assert.equal(results.length, 150);
  assert.equal(results.every((result) => result.product.currentPriceCzk <= 1000), true);
});
