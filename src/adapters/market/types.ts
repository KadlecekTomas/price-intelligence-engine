import type { MarketOffer, MarketVerification } from "@/domain/market-offer";
import type { MarketSearchIntent } from "@/domain/market-search";

export type MarketProviderSearchResult = {
  offers: MarketOffer[];
  catalogCount: number;
  matchedCount: number;
  checkedCount: number;
  verification: MarketVerification;
  warning: string | null;
};

export type MarketProvider = {
  id: string;
  name: string;
  search(intent: MarketSearchIntent): Promise<MarketProviderSearchResult>;
};
