import { footshopCzMarketProvider } from "@/adapters/market/footshop-cz";
import { queensCzMarketProvider } from "@/adapters/market/queens-cz";
import type { MarketProvider } from "@/adapters/market/types";
import type { MarketOffer, MarketSearchResult, MarketSourceStatus } from "@/domain/market-offer";
import type { MarketSearchIntent } from "@/domain/market-search";

export const MARKET_PROVIDERS: MarketProvider[] = [
  footshopCzMarketProvider,
  queensCzMarketProvider,
];

function dedupeOffers(offers: MarketOffer[]) {
  const deduped = new Map<string, MarketOffer>();
  for (const offer of offers) {
    const key = `${offer.shopId}:${offer.gtin ?? offer.sku ?? offer.url}`;
    const existing = deduped.get(key);
    if (!existing || offer.priceCzk < existing.priceCzk) deduped.set(key, offer);
  }
  return [...deduped.values()];
}

export async function aggregateMarketProviders(
  intent: MarketSearchIntent,
  providers: MarketProvider[],
): Promise<MarketSearchResult> {
  const startedAt = Date.now();
  const settled = await Promise.allSettled(providers.map(async (provider) => {
    const started = Date.now();
    const result = await provider.search(intent);
    return {
      provider,
      result,
      durationMs: Date.now() - started,
    };
  }));

  const sources: MarketSourceStatus[] = [];
  const offers: MarketOffer[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const provider = providers[index];
    if (result.status === "rejected") {
      sources.push({
        shopId: provider.id,
        shopName: provider.name,
        status: "failed",
        catalogCount: 0,
        candidateCount: 0,
        offerCount: 0,
        durationMs: Date.now() - startedAt,
        warning: "Zdroj se nepodařilo načíst.",
      });
      warnings.push(`${provider.name} se při tomto hledání nepodařilo ověřit.`);
      continue;
    }

    const { result: providerResult, durationMs } = result.value;
    offers.push(...providerResult.offers);
    const status = providerResult.warning ? "partial" : "ok";
    sources.push({
      shopId: provider.id,
      shopName: provider.name,
      status,
      catalogCount: providerResult.catalogCount,
      candidateCount: providerResult.candidateCount,
      offerCount: providerResult.offers.length,
      durationMs,
      warning: providerResult.warning,
    });
    if (providerResult.warning) warnings.push(providerResult.warning);
  }

  const sortedOffers = dedupeOffers(offers)
    .filter((offer) => offer.availability !== "out_of_stock")
    .sort((a, b) => {
      if (intent.sort === "cheapest") {
        return a.priceCzk - b.priceCzk || b.matchScore - a.matchScore;
      }
      return b.matchScore - a.matchScore || a.priceCzk - b.priceCzk;
    });

  if (sortedOffers.length > 0 && sortedOffers.some((offer) => offer.shippingCzk === null)) {
    warnings.push("Řazení zatím porovnává cenu produktu; dopravu započítáme až po spolehlivém ověření konkrétního způsobu doručení.");
  }
  if (intent.size && sortedOffers.some((offer) => offer.requestedSizeStatus === "unknown")) {
    warnings.push(`U části nabídek neumíme z veřejného detailu potvrdit velikost ${intent.size}; tyto nabídky jsou označené k ověření.`);
  }

  return {
    offers: sortedOffers,
    sources,
    checkedAt: new Date().toISOString(),
    warnings: [...new Set(warnings)],
  };
}

export async function searchMarket(intent: MarketSearchIntent) {
  return aggregateMarketProviders(intent, MARKET_PROVIDERS);
}
