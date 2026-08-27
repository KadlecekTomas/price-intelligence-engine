import assert from "node:assert/strict";
import test from "node:test";
import { parseAboutYouCard } from "@/domain/aboutyou-card";

test("does not mistake an original price rendered first for the current price", () => {
  const product = parseAboutYouCard(
    "https://www.aboutyou.cz/p/test/product-1",
    "BOSS Tričko Původně: 1 299 Kč 599 Kč Poslední nejnižší cena: 499 Kč",
  );

  assert.ok(product);
  assert.equal(product.currentPriceCzk, 599);
  assert.equal(product.originalPriceCzk, 1299);
  assert.equal(product.lowest30dCzk, 499);
});

test("does not mistake a 30-day low rendered first for the current price", () => {
  const product = parseAboutYouCard(
    "https://www.aboutyou.cz/p/test/product-2",
    "LEVI'S Tričko Poslední nejnižší cena: 399 Kč 549 Kč Původně: 799 Kč",
  );

  assert.ok(product);
  assert.equal(product.currentPriceCzk, 549);
  assert.equal(product.originalPriceCzk, 799);
  assert.equal(product.lowest30dCzk, 399);
});
