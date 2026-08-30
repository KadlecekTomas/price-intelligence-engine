import { buzzCzMarketProvider } from "@/adapters/market/buzz-cz";
import { parseMarketSearchIntent } from "@/domain/market-search";

async function main() {
  const intent = parseMarketSearchIntent("Nike Air Force 1");
  if (!intent.exactProduct) throw new Error("Probe intent did not resolve to an exact product");

  const result = await buzzCzMarketProvider.search(intent);
  console.log(`BUZZ verification: ${result.verification}`);
  console.log(`BUZZ collection count: ${result.catalogCount}`);
  console.log(`BUZZ candidate PDPs: ${result.matchedCount}`);
  console.log(`BUZZ checked PDPs: ${result.checkedCount}`);
  console.log(`BUZZ live offers: ${result.offers.length}`);

  for (const offer of result.offers.slice(0, 5)) {
    console.log(`OFFER: ${offer.title} · ${offer.priceCzk.toLocaleString("cs-CZ")} Kč · ${offer.url}`);
  }

  if (result.verification !== "live") {
    throw new Error(`Buzz provider is not live: ${result.verification}`);
  }
  if (result.catalogCount < 2) {
    throw new Error(`Buzz collection reported implausible count: ${result.catalogCount}`);
  }
  if (result.checkedCount < 1 || result.offers.length < 1) {
    throw new Error("Buzz provider did not verify any live product offer");
  }
  if (result.offers.some((offer) => offer.priceCzk < 300 || offer.priceCzk > 20_000)) {
    throw new Error("Buzz provider returned an implausible CZK price");
  }
}

main().catch((error) => {
  console.error("Buzz market probe failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
