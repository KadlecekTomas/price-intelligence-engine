import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_MARKET_PROVIDERS,
  SHOP_REGISTRY,
  shopIntegrationSummary,
} from "@/adapters/shop-registry";

test("active market providers have unique ids and matching registry entries", () => {
  const ids = ACTIVE_MARKET_PROVIDERS.map((provider) => provider.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ["aboutyou-cz", "zalando-cz", "footshop-cz", "queens-cz"]);

  for (const provider of ACTIVE_MARKET_PROVIDERS) {
    const entry = SHOP_REGISTRY.find((shop) => shop.id === provider.id);
    assert.equal(entry?.state, "active");
    assert.equal(entry?.marketProvider?.id, provider.id);
  }
});

test("only verified full-catalog shops claim full catalog tracking", () => {
  const fullCatalog = SHOP_REGISTRY.filter((shop) => shop.fullCatalog);
  assert.deepEqual(fullCatalog.map((shop) => shop.id), ["aboutyou-cz"]);
  assert.equal(fullCatalog[0].trackingMode, "full-catalog");
});

test("registry exposes active and candidate integration counts", () => {
  assert.deepEqual(shopIntegrationSummary(), {
    active: 4,
    candidates: 4,
    fullCatalog: 1,
    onDemand: 7,
  });
});
