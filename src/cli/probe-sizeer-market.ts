import { sizeerCzMarketProvider } from "@/adapters/market/sizeer-cz";
import { parseMarketSearchIntent } from "@/domain/market-search";

async function main() {
  const intent = parseMarketSearchIntent("Nike Air Force 1");
  if (!intent.exactProduct) throw new Error("Probe intent did not resolve to an exact product");

  const result = await sizeerCzMarketProvider.search(intent);
  console.log(`SIZEER verification: ${result.verification}`);
  console.log(`SIZEER collection count: ${result.catalogCount}`);
  console.log(`SIZEER candidate PDPs: ${result.matchedCount}`);
  console.log(`SIZEER checked PDPs: ${result.checkedCount}`);
  console.log(`SIZEER live offers: ${result.offers.length}`);

  for (const offer of result.offers.slice(0, 5)) {
    console.log(`OFFER: ${offer.title} · ${offer.priceCzk.toLocaleString("cs-CZ")} Kč · ${offer.url}`);
  }

  if (result.verification !== "live") {
    throw new Error(`Sizeer provider is not live: ${result.verification}`);
  }
  if (result.catalogCount < 10) {
    throw new Error(`Sizeer collection reported implausible count: ${result.catalogCount}`);
  }
  if (result.checkedCount < 1 || result.offers.length < 1) {
    throw new Error("Sizeer provider did not verify any live product offer");
  }
  if (result.offers.some((offer) => offer.priceCzk < 300 || offer.priceCzk > 20_000)) {
    throw new Error("Sizeer provider returned an implausible CZK price");
  }
}

main().catch((error) => {
  console.error("Sizeer market probe failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
