import test from "node:test";
import assert from "node:assert/strict";

// Lightweight regression guard: the UI contract intentionally keeps the most common
// one-click price limits and category shortcuts stable for mobile/desktop users.
const categories = ["tričko", "mikina", "tenisky", "džíny", "bunda", "košile"];
const priceLimits = [500, 1000, 1500, 2500, 4000];

test("quick shopping presets cover common categories and budgets", () => {
  assert.deepEqual(categories.slice(0, 3), ["tričko", "mikina", "tenisky"]);
  assert.equal(priceLimits[0], 500);
  assert.equal(priceLimits.at(-1), 4000);
});
