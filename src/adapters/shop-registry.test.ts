import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_MARKET_PROVIDERS,
  SHOP_REGISTRY,
  shopIntegrationSummary,
} from "@/adapters/shop-registry";

test("aggregated providers have unique ids and are active or partial", () => {
  const ids = ACTIVE_MARKET_PROVIDERS.map((provider) => provider.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ["aboutyou-cz", "footshop-cz", "queens-cz"]);

  for (const provider of ACTIVE_MARKET_PROVIDERS) {
    const entry = SHOP_REGISTRY.find((shop) => shop.id === provider.id);
    assert.ok(entry?.state === "active" || entry?.state === "partial");
    assert.equal(entry?.marketProvider?.id, provider.id);
  }
});

test("candidate providers never enter market aggregation", () => {
  const aggregatedIds = new Set(ACTIVE_MARKET_PROVIDERS.map((provider) => provider.id));
  for (const shop of SHOP_REGISTRY.filter((entry) => entry.state === "candidate")) {
    assert.equal(aggregatedIds.has(shop.id), false);
  }
});

test("only verified full-catalog shops claim full catalog tracking", () => {
  const fullCatalog = SHOP_REGISTRY.filter((shop) => shop.fullCatalog);
  assert.deepEqual(fullCatalog.map((shop) => shop.id), ["aboutyou-cz"]);
  assert.equal(fullCatalog[0].trackingMode, "full-catalog");
});

test("registry exposes active, partial and candidate integration counts", () => {
  assert.deepEqual(shopIntegrationSummary(), {
    active: 1,
    partial: 2,
    candidates: 5,
    fullCatalog: 1,
    onDemand: 7,
  });
});
