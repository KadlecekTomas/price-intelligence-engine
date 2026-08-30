import { zalandoCzMarketProvider } from "@/adapters/market/zalando-cz";
import { parseMarketSearchIntent } from "@/domain/market-search";

async function main() {
  const intent = parseMarketSearchIntent("Nike Air Force 1");
  if (!intent.exactProduct) throw new Error("Probe intent did not resolve to an exact product");

  const result = await zalandoCzMarketProvider.search(intent);
  console.log(`ZALANDO verification: ${result.verification}`);
  console.log(`ZALANDO catalog matches: ${result.catalogCount}`);
  console.log(`ZALANDO candidate PDPs: ${result.matchedCount}`);
  console.log(`ZALANDO checked PDPs: ${result.checkedCount}`);
  console.log(`ZALANDO live offers: ${result.offers.length}`);

  for (const offer of result.offers.slice(0, 5)) {
    console.log(`OFFER: ${offer.title} · ${offer.priceCzk.toLocaleString("cs-CZ")} Kč · ${offer.url}`);
  }

  if (result.verification !== "live") {
    throw new Error(`Zalando provider is not live: ${result.verification}`);
  }
  if (result.catalogCount < 10) {
    throw new Error(`Zalando search reported implausible catalog count: ${result.catalogCount}`);
  }
  if (result.checkedCount < 1 || result.offers.length < 1) {
    throw new Error("Zalando provider did not verify any live product offer");
  }
  if (result.offers.some((offer) => offer.priceCzk < 300 || offer.priceCzk > 20_000)) {
    throw new Error("Zalando provider returned an implausible CZK price");
  }
}

main().catch((error) => {
  console.error("Zalando market probe failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
