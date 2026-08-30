import test from "node:test";
import assert from "node:assert/strict";
import {
  marketTitleMatchesIntent,
  marketUrlMatchesIntent,
  parseMarketSearchIntent,
} from "@/domain/market-search";

test("resolves adidas NMD R1 as an exact cheapest-market query", () => {
  const intent = parseMarketSearchIntent("adidas nmd r1 nejlevnější");
  assert.equal(intent.exactProduct, true);
  assert.equal(intent.brand, "adidas");
  assert.equal(intent.model, "nmd r1");
  assert.equal(intent.sort, "cheapest");
  assert.equal(intent.size, null);
  assert.equal(intent.canonicalKey, "adidas:nmdr1");
});

test("consumes a trailing shoe size without polluting the model", () => {
  const intent = parseMarketSearchIntent("adidas samba 43 nejlevnější");
  assert.equal(intent.model, "samba");
  assert.equal(intent.size, "43");
});

test("keeps numeric model names such as New Balance 530", () => {
  const intent = parseMarketSearchIntent("New Balance 530 nejlevnější");
  assert.equal(intent.exactProduct, true);
  assert.equal(intent.brand, "new balance");
  assert.equal(intent.model, "530");
  assert.equal(intent.size, null);
});

test("does not turn a generic shopping query into exact market search", () => {
  const intent = parseMarketSearchIntent("černé tričko L do 1500 Kč");
  assert.equal(intent.exactProduct, false);
});

test("nike boty is a brand/category query, not an exact model query", () => {
  const intent = parseMarketSearchIntent("nike boty nejlevnější");
  assert.equal(intent.exactProduct, false);
  assert.equal(intent.brand, "nike");
  assert.equal(intent.model, null);
});

test("matches compact model spelling in product URLs and titles", () => {
  const intent = parseMarketSearchIntent("adidas nmd r1 nejlevnější");
  assert.equal(
    marketUrlMatchesIntent("https://shop.test/adidas-nmdr1-core-black.html", intent),
    true,
  );
  assert.equal(marketTitleMatchesIntent("adidas Originals NMD_R1 Core Black", intent), true);
  assert.equal(marketTitleMatchesIntent("adidas Samba OG", intent), false);
});
