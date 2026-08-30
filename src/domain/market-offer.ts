import type { MarketVerification } from "@/adapters/market/types";

export type OfferAvailability = "in_stock" | "out_of_stock" | "unknown";

export type MarketOffer = {
  id: string;
  shopId: string;
  shopName: string;
  url: string;
  title: string;
  brand: string | null;
  model: string | null;
  sku: string | null;
  gtin: string | null;
  color: string | null;
  priceCzk: number;
  shippingCzk: number | null;
  totalPriceCzk: number;
  currency: "CZK";
  availability: OfferAvailability;
  sizes: string[];
  requestedSizeStatus: "available" | "unavailable" | "unknown";
  matchScore: number;
  source: "sitemap-pdp" | "catalog-index";
  checkedAt: string;
};

export type MarketSourceStatus = {
  shopId: string;
  shopName: string;
  status: "ok" | "partial" | "failed";
  verification: MarketVerification;
  catalogCount: number;
  matchedCount: number;
  checkedCount: number;
  offerCount: number;
  durationMs: number;
  warning: string | null;
};

export type MarketSearchResult = {
  offers: MarketOffer[];
  sources: MarketSourceStatus[];
  checkedAt: string;
  warnings: string[];
};
