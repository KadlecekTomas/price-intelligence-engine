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
  assert.deepEqual(intent.excludedTerms, []);
  assert.equal(intent.sort, "deal");
});

test("parses thousands and excluded material", () => {
  const intent = parseNaturalSearch("kvalitní mikinu do 2 tisíc bez polyesteru");
  assert.equal(intent.category, "mikina");
  assert.equal(intent.maxPriceCzk, 2000);
  assert.deepEqual(intent.excludedMaterials, ["polyester"]);
  assert.deepEqual(intent.excludedTerms, []);
  assert.equal(intent.qualityPreferred, true);
});

test("parses decimal thousand shorthand without turning 1,5k into 5k", () => {
  assert.equal(parseNaturalSearch("tričko do 1,5k").maxPriceCzk, 1500);
  assert.equal(parseNaturalSearch("tričko do 1.5k").maxPriceCzk, 1500);
});

test("understands generic negative feature instead of requiring it", () => {
  const intent = parseNaturalSearch("černé tričko L do 500 Kč, bez limecku");
  assert.equal(intent.category, "tričko");
  assert.equal(intent.color, "černá");
  assert.equal(intent.size, "L");
  assert.equal(intent.maxPriceCzk, 500);
  assert.deepEqual(intent.excludedTerms, ["límeček"]);
  assert.equal(intent.requiredTerms.includes("limecku"), false);
});

test("does not turn compact price syntax into a required keyword", () => {
  const intent = parseNaturalSearch("tricko L do 250kc");
  assert.equal(intent.category, "tričko");
  assert.equal(intent.size, "L");
  assert.equal(intent.maxPriceCzk, 250);
  assert.equal(intent.requiredTerms.includes("250kc"), false);
  assert.deepEqual(intent.requiredTerms, []);
});

test("keeps half shoe sizes and supports XXS", () => {
  assert.equal(parseNaturalSearch("bílé tenisky velikost 43,5").size, "43,5");
  assert.equal(parseNaturalSearch("tričko XXS").size, "XXS");
});

test("supports common no-logo and no-print phrases", () => {
  const noLogo = parseNaturalSearch("černá mikina bez velkého loga");
  const noPrint = parseNaturalSearch("tričko bez potisku");
  assert.deepEqual(noLogo.excludedTerms, ["logo"]);
  assert.equal(noLogo.requiredTerms.includes("loga"), false);
  assert.deepEqual(noPrint.excludedTerms, ["potisk"]);
});

test("keeps unknown brand term as required text", () => {
  const intent = parseNaturalSearch("Nike bílé tenisky velikost 43");
  assert.equal(intent.category, "tenisky");
  assert.equal(intent.color, "bílá");
  assert.equal(intent.size, "43");
  assert.ok(intent.requiredTerms.includes("nike"));
});

test("required brand terms match tokens, not arbitrary substrings", () => {
  const intent = parseNaturalSearch("BOSS tričko");
  const results = searchProducts([
    product({ id: "boss", text: "BOSS černé tričko L" }),
    product({ id: "embossed", text: "Tričko s embossed potiskem L" }),
  ], intent);
  assert.deepEqual(results.map((result) => result.product.id), ["boss"]);
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

test("excludes an explicitly collared product for bez limecku", () => {
  const intent = parseNaturalSearch("černé tričko L do 500 bez limecku");
  const results = searchProducts([
    product({ id: "plain", currentPriceCzk: 499, text: "TOM TAILOR černé tričko velikost L", color: "černá" }),
    product({ id: "polo", currentPriceCzk: 479, text: "Černé polotričko s límečkem velikost L", color: "černá" }),
  ], intent);

  assert.equal(results.length, 1);
  assert.equal(results[0]?.product.id, "plain");
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
