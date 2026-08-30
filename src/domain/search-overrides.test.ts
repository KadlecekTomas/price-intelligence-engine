import test from "node:test";
import assert from "node:assert/strict";
import { parseNaturalSearch } from "@/domain/natural-search";
import { applySearchParamOverrides } from "@/domain/search-overrides";

test("structured filters override ambiguous natural-language intent", () => {
  const base = parseNaturalSearch("modré tričko M do 2500 Kč");
  const params = new URLSearchParams({
    category: "tenisky",
    color: "černá",
    size: "43,5",
    maxPrice: "1800",
    material: "kůže",
    sort: "price",
    quality: "1",
  });

  const result = applySearchParamOverrides(base, params);

  assert.equal(result.category, "tenisky");
  assert.equal(result.color, "černá");
  assert.equal(result.size, "43,5");
  assert.equal(result.maxPriceCzk, 1800);
  assert.deepEqual(result.materials, ["kůže"]);
  assert.equal(result.sort, "price");
  assert.equal(result.qualityPreferred, true);
});

test("invalid structured filters are ignored safely", () => {
  const base = parseNaturalSearch("černé tričko L do 1500 Kč");
  const params = new URLSearchParams({
    category: "vesmírný oblek",
    color: "duhová",
    size: "999",
    maxPrice: "-20",
    material: "adamantium",
    sort: "random",
  });

  const result = applySearchParamOverrides(base, params);

  assert.equal(result.category, base.category);
  assert.equal(result.color, base.color);
  assert.equal(result.size, base.size);
  assert.equal(result.maxPriceCzk, base.maxPriceCzk);
  assert.deepEqual(result.materials, base.materials);
  assert.equal(result.sort, base.sort);
});
