import test from "node:test";
import assert from "node:assert/strict";
import type { MarketProvider } from "@/adapters/market/types";
import type { MarketOffer } from "@/domain/market-offer";
import { parseMarketSearchIntent } from "@/domain/market-search";
import { aggregateMarketProviders } from "@/lib/market-search";

function offer(shopId: string, shopName: string, priceCzk: number): MarketOffer {
  return {
    id: `${shopId}:${priceCzk}`,
    shopId,
    shopName,
    url: `https://${shopId}.test/product`,
    title: "adidas NMD_R1",
    brand: "adidas",
    model: "nmd r1",
    sku: `${shopId}-sku`,
    gtin: null,
    color: null,
    priceCzk,
    shippingCzk: null,
    totalPriceCzk: priceCzk,
    currency: "CZK",
    availability: "in_stock",
    sizes: [],
    requestedSizeStatus: "unknown",
    matchScore: 95,
    source: "sitemap-pdp",
    checkedAt: new Date().toISOString(),
  };
}

function providerResult(offers: MarketOffer[], catalogCount: number, matchedCount = 1) {
  return {
    offers,
    catalogCount,
    matchedCount,
    checkedCount: matchedCount,
    verification: "live" as const,
    warning: null,
  };
}

test("sorts exact market offers by lowest product price", async () => {
  const intent = parseMarketSearchIntent("adidas nmd r1 nejlevnější");
  const providers: MarketProvider[] = [
    { id: "a", name: "A", async search() { return providerResult([offer("a", "A", 2499)], 10000); } },
    { id: "b", name: "B", async search() { return providerResult([offer("b", "B", 1999)], 8000); } },
  ];

  const result = await aggregateMarketProviders(intent, providers);
  assert.equal(result.offers[0].shopName, "B");
  assert.equal(result.offers[0].priceCzk, 1999);
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources.reduce((sum, source) => sum + source.catalogCount, 0), 18000);
  assert.match(result.warnings.join(" "), /dopravu/i);
});

test("keeps successful shops when another provider fails", async () => {
  const intent = parseMarketSearchIntent("adidas samba nejlevnější");
  const providers: MarketProvider[] = [
    { id: "ok", name: "OK Shop", async search() { return providerResult([offer("ok", "OK Shop", 2200)], 12000); } },
    { id: "bad", name: "Bad Shop", async search() { throw new Error("down"); } },
  ];

  const result = await aggregateMarketProviders(intent, providers);
  assert.equal(result.offers.length, 1);
  assert.equal(result.sources.find((source) => source.shopId === "bad")?.status, "failed");
  assert.equal(result.sources.find((source) => source.shopId === "bad")?.catalogCount, 0);
  assert.match(result.warnings.join(" "), /Bad Shop/);
});

test("marks catalog-only blocked price verification as partial", async () => {
  const intent = parseMarketSearchIntent("puma speedcat nejlevnější");
  const providers: MarketProvider[] = [{
    id: "catalog",
    name: "Catalog Shop",
    async search() {
      return {
        offers: [],
        catalogCount: 15000,
        matchedCount: 23,
        checkedCount: 0,
        verification: "blocked" as const,
        warning: "Cena se nepodařila serverově ověřit.",
      };
    },
  }];

  const result = await aggregateMarketProviders(intent, providers);
  assert.equal(result.sources[0].status, "partial");
  assert.equal(result.sources[0].verification, "blocked");
  assert.equal(result.sources[0].matchedCount, 23);
  assert.equal(result.offers.length, 0);
});
