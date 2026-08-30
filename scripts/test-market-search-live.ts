import { parseMarketSearchIntent } from "../src/domain/market-search";
import { searchMarket } from "../src/lib/market-search";

const queries = [
  "puma speedcat nejlevnější",
  "adidas nmd r1 nejlevnější",
];

for (const query of queries) {
  const intent = parseMarketSearchIntent(query);
  console.log("MARKET_QUERY", query);
  console.log("MARKET_INTENT", JSON.stringify(intent));
  const started = Date.now();
  const result = await searchMarket(intent);
  console.log("MARKET_DURATION_MS", Date.now() - started);
  console.log("MARKET_CATALOG_COUNT", result.sources.reduce((sum, source) => sum + source.catalogCount, 0));
  for (const source of result.sources) {
    console.log("MARKET_SOURCE", JSON.stringify(source));
  }
  console.log("MARKET_OFFERS", result.offers.length);
  for (const offer of result.offers.slice(0, 10)) {
    console.log("MARKET_OFFER", JSON.stringify({
      shop: offer.shopName,
      title: offer.title,
      priceCzk: offer.priceCzk,
      availability: offer.availability,
      sku: offer.sku,
      gtin: offer.gtin,
      url: offer.url,
      matchScore: offer.matchScore,
    }));
  }
  console.log("MARKET_WARNINGS", JSON.stringify(result.warnings));
}
