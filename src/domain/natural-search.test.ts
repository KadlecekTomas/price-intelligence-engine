import assert from "node:assert/strict";
import test from "node:test";
import { parseNaturalSearch, searchProducts } from "@/domain/natural-search";
import type { ScannedProduct } from "@/lib/discovery-state";

function product(overrides: Partial<ScannedProduct> = {}): ScannedProduct {
  return {
    id: "p1",
    url: "https://example.test/p1",
    text: "Levi's černé tričko velikost L 100% bavlna",
    currentPriceCzk: 799,
    originalPriceCzk: 1299,
    lowest30dCzk: 779,
    ratioToLow: 799 / 779,
    discountPct: 1 - 799 / 1299,
    dealScore: 98,
    verdict: "TOP",
    enriched: true,
    material: "100% bavlna",
    fit: "Regular",
    color: "černá",
    itemNumber: "ABC",
    materialScore: 78,
    buyScore: 92,
    qualitySignals: ["100% bavlna"],
    observedMinCzk: 749,
    observedMaxCzk: 1299,
    observationCount: 4,
    ratioToObservedMin: 799 / 749,
    historyScore: 93,
    ...overrides,
  };
}

test("parses Czech apparel query", () => {
  const intent = parseNaturalSearch("černé tričko L do 1 500 Kč, ideálně bavlna, top deal");
  assert.equal(intent.category, "tričko");
  assert.equal(intent.color, "černá");
  assert.equal(intent.size, "L");
  assert.equal(intent.maxPriceCzk, 1500);
  assert.deepEqual(intent.materials, ["bavlna"]);
  assert.equal(intent.sort, "deal");
});

test("parses thousands and excluded material", () => {
  const intent = parseNaturalSearch("kvalitní mikinu do 2 tisíc bez polyesteru");
  assert.equal(intent.category, "mikina");
  assert.equal(intent.maxPriceCzk, 2000);
  assert.deepEqual(intent.excludedMaterials, ["polyester"]);
  assert.equal(intent.qualityPreferred, true);
});

test("keeps unknown brand term as required text", () => {
  const intent = parseNaturalSearch("Nike bílé tenisky velikost 43");
  assert.equal(intent.category, "tenisky");
  assert.equal(intent.color, "bílá");
  assert.equal(intent.size, "43");
  assert.ok(intent.requiredTerms.includes("nike"));
});

test("filters and ranks matching products", () => {
  const intent = parseNaturalSearch("černé tričko L do 1000 bavlna");
  const results = searchProducts([
    product(),
    product({ id: "p2", text: "Bílé tričko L", color: "bílá" }),
    product({ id: "p3", currentPriceCzk: 1599 }),
  ], intent);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.product.id, "p1");
});

test("flags fake sale when current price is far above 30d low", () => {
  const p = product({
    currentPriceCzk: 900,
    originalPriceCzk: 1200,
    lowest30dCzk: 500,
    ratioToLow: 1.8,
    discountPct: 0.25,
    dealScore: 36,
    buyScore: 45,
  });
  const result = searchProducts([p], parseNaturalSearch("tričko"))[0];
  assert.equal(result?.recommendation, "FAKE_SALE");
});
