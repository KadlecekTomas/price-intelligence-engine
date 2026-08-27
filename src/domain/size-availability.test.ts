import assert from "node:assert/strict";
import test from "node:test";
import { extractAvailableSizes, normalizeSize, sizeAvailabilityFromText } from "@/domain/size-availability";

test("keeps W/L jeans sizes together", () => {
  const text = "Dostupné velikosti: W30/L30, W32/L30, W32/L32 Původně: 1 499 Kč";
  assert.deepEqual(extractAvailableSizes(text), ["W30/L30", "W32/L30", "W32/L32"]);
  assert.equal(sizeAvailabilityFromText(text, "W32/L30"), "yes");
  assert.equal(sizeAvailabilityFromText(text, "W34/L30"), "no");
});

test("normalizes X notation for jeans sizes", () => {
  assert.equal(normalizeSize("W32 x L30"), "W32/L30");
  assert.equal(sizeAvailabilityFromText("Dostupné velikosti: W32 x L30, W34 x L32", "W32/L30"), "yes");
});

test("keeps half shoe sizes instead of splitting 43,5", () => {
  const text = "Dostupné velikosti: 42, 42,5, 43, 43,5, 44 Původně: 2 499 Kč";
  assert.equal(sizeAvailabilityFromText(text, "43,5"), "yes");
  assert.equal(sizeAvailabilityFromText(text, "44,5"), "no");
});

test("handles apparel sizes including XXS", () => {
  const text = "Dostupné velikosti: XXS, XS, S, M, L, XL";
  assert.equal(sizeAvailabilityFromText(text, "XXS"), "yes");
  assert.equal(sizeAvailabilityFromText(text, "XXL"), "no");
});
