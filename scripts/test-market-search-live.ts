import { parseMarketProductPage } from "../src/domain/market-product-page";
import { marketProductMatchesIntent, parseMarketSearchIntent } from "../src/domain/market-search";
import { searchMarket } from "../src/lib/market-search";

const HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
  "User-Agent": "PriceIntelligence/0.1 (+https://github.com/KadlecekTomas/price-intelligence-engine)",
};

async function inspectPdp(url: string) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
  const html = await response.text();
  const parsed = parseMarketProductPage(html);
  const intent = parseMarketSearchIntent("puma speedcat nejlevnější");
  console.log("PDP_URL", url);
  console.log("PDP_STATUS", response.status, "BYTES", html.length);
  console.log("PDP_JSONLD_COUNT", (html.match(/application\/ld\+json/gi) ?? []).length);
  console.log("PDP_PARSED", JSON.stringify(parsed));
  console.log("PDP_MATCH", parsed ? marketProductMatchesIntent(parsed.title, parsed.brand, intent) : false);
  console.log("PDP_H1", (html.match(/<h1[^>]*>[\s\S]{0,500}?<\/h1>/i)?.[0] ?? "NONE").replace(/\s+/g, " ").slice(0, 500));
  console.log("PDP_PRICE_META", (html.match(/<meta[^>]+(?:product:price:amount|itemprop=["']price["'])[^>]*>/gi) ?? []).slice(0, 5));
}

async function main() {
  await inspectPdp("https://www.footshop.cz/cs/panske-tenisky-a-boty/337498-puma-speedcat-og-black.html");
  await inspectPdp("https://www.queens.cz/cs/panske-tenisky-a-boty/448735-puma-speedcat-metallic-puma-black-warm-white.html");

  for (const query of ["puma speedcat nejlevnější", "adidas nmd r1 nejlevnější"]) {
    const intent = parseMarketSearchIntent(query);
    console.log("MARKET_QUERY", query);
    const started = Date.now();
    const result = await searchMarket(intent);
    console.log("MARKET_DURATION_MS", Date.now() - started);
    console.log("MARKET_CATALOG_COUNT", result.sources.reduce((sum, source) => sum + source.catalogCount, 0));
    for (const source of result.sources) console.log("MARKET_SOURCE", JSON.stringify(source));
    console.log("MARKET_OFFERS", result.offers.length);
    for (const offer of result.offers.slice(0, 10)) {
      console.log("MARKET_OFFER", JSON.stringify({ shop: offer.shopName, title: offer.title, priceCzk: offer.priceCzk, availability: offer.availability, sku: offer.sku, gtin: offer.gtin, url: offer.url, matchScore: offer.matchScore }));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
