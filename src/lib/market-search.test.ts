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

test("sorts exact market offers by lowest product price", async () => {
  const intent = parseMarketSearchIntent("adidas nmd r1 nejlevnější");
  const providers: MarketProvider[] = [
    { id: "a", name: "A", async search() { return { offers: [offer("a", "A", 2499)], catalogCount: 10000, candidateCount: 1, warning: null }; } },
    { id: "b", name: "B", async search() { return { offers: [offer("b", "B", 1999)], catalogCount: 8000, candidateCount: 1, warning: null }; } },
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
    { id: "ok", name: "OK Shop", async search() { return { offers: [offer("ok", "OK Shop", 2200)], catalogCount: 12000, candidateCount: 1, warning: null }; } },
    { id: "bad", name: "Bad Shop", async search() { throw new Error("down"); } },
  ];

  const result = await aggregateMarketProviders(intent, providers);
  assert.equal(result.offers.length, 1);
  assert.equal(result.sources.find((source) => source.shopId === "bad")?.status, "failed");
  assert.equal(result.sources.find((source) => source.shopId === "bad")?.catalogCount, 0);
  assert.match(result.warnings.join(" "), /Bad Shop/);
});
