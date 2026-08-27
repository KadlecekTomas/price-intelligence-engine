import assert from "node:assert/strict";
import test from "node:test";
import { readPublicProducts } from "@/lib/supabase-read";

test("maps public Supabase view rows into scanned products", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([
    {
      external_key: "abc",
      url: "https://shop.test/p/abc",
      raw_text: "Černé tričko L",
      item_number: "ABC-1",
      material: "100% bavlna",
      fit: "Regular",
      color: "černá",
      quality_signals: ["100% bavlna"],
      current_price_czk: 799,
      original_price_czk: 1299,
      lowest_30d_czk: 779,
      deal_score: 97,
      material_score: 78,
      buy_score: 91,
      verdict: "TOP",
      observed_min_czk: 749,
      observed_max_czk: 1299,
      observation_count: 4,
      ratio_to_low: 799 / 779,
      discount_pct: 1 - 799 / 1299,
      ratio_to_observed_min: 799 / 749,
      history_score: 93,
    },
  ]), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const products = await readPublicProducts(10);
    assert.equal(products.length, 1);
    assert.equal(products[0]?.id, "abc");
    assert.equal(products[0]?.currentPriceCzk, 799);
    assert.equal(products[0]?.historyScore, 93);
    assert.deepEqual(products[0]?.qualitySignals, ["100% bavlna"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("throws when public Supabase read fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("denied", { status: 403 });

  try {
    await assert.rejects(() => readPublicProducts(10), /403/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
