import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAndRankProducts,
  matchesShoppingFilters,
  parseShoppingFilters,
} from "@/domain/shopping-filters";
import type { ScannedProduct } from "@/lib/discovery-state";

function product(overrides: Partial<ScannedProduct> = {}): ScannedProduct {
  return {
    id: "p1",
    url: "https://example.test/p/1",
    text: "Tričko Premium Velikosti S, M, L 999 Kč",
    currentPriceCzk: 999,
    originalPriceCzk: 1499,
    lowest30dCzk: 899,
    ratioToLow: 1.11,
    discountPct: 0.33,
    dealScore: 91,
    verdict: "GOOD",
    enriched: true,
    material: "100% bavlna",
    fit: "regular",
    color: "černá",
    itemNumber: "ABC123",
    materialScore: 77,
    buyScore: 86,
    qualitySignals: ["profil:tops", "100% bavlna"],
    observedMinCzk: 799,
    observedMaxCzk: 1299,
    observationCount: 3,
    ratioToObservedMin: 1.25,
    historyScore: 75,
    ...overrides,
  };
}

test("parses command line shopping filters", () => {
  const filters = parseShoppingFilters([
    "--max-price=2000",
    "--min-buy=70",
    "--min-history=60",
    "--contains=tričko",
    "--size=L",
    "--limit=15",
  ]);

  assert.deepEqual(filters, {
    maxPriceCzk: 2000,
    minBuyScore: 70,
    minHistoryScore: 60,
    contains: "tričko",
    size: "L",
    limit: 15,
  });
});

test("caps result limit and ignores invalid numeric values", () => {
  assert.equal(parseShoppingFilters(["--limit=999"]).limit, 100);
  assert.equal(parseShoppingFilters(["--limit=0"]).limit, 1);
  assert.equal(parseShoppingFilters(["--max-price=nope"]).maxPriceCzk, null);
});

test("filters by price, score, text and best-effort size", () => {
  const candidate = product();
  const filters = parseShoppingFilters([
    "--max-price=1200",
    "--min-buy=80",
    "--contains=bavlna",
    "--size=L",
  ]);

  assert.equal(matchesShoppingFilters(candidate, filters), true);
  assert.equal(
    matchesShoppingFilters(product({ currentPriceCzk: 1500 }), filters),
    false,
  );
  assert.equal(matchesShoppingFilters(product({ buyScore: 60 }), filters), false);
  assert.equal(matchesShoppingFilters(product({ text: "Mikina S, M" }), filters), false);
});

test("history filter requires owned history", () => {
  const filters = parseShoppingFilters(["--min-history=80"]);
  assert.equal(matchesShoppingFilters(product({ historyScore: 90 }), filters), true);
  assert.equal(matchesShoppingFilters(product({ historyScore: 70 }), filters), false);
  assert.equal(matchesShoppingFilters(product({ historyScore: null }), filters), false);
});

test("ranks by buy score, then history, then lower price", () => {
  const filters = parseShoppingFilters(["--limit=3"]);
  const ranked = filterAndRankProducts(
    [
      product({ id: "cheap", buyScore: 80, historyScore: 90, currentPriceCzk: 700 }),
      product({ id: "best", buyScore: 95, historyScore: 40, currentPriceCzk: 1500 }),
      product({ id: "history", buyScore: 80, historyScore: 95, currentPriceCzk: 1200 }),
      product({ id: "cut", buyScore: 60, currentPriceCzk: 300 }),
    ],
    filters,
  );

  assert.deepEqual(ranked.map((item) => item.id), ["best", "history", "cheap"]);
});
