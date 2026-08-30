import { aboutYouCzMarketProvider } from "@/adapters/market/aboutyou-cz";
import { footshopCzMarketProvider } from "@/adapters/market/footshop-cz";
import { queensCzMarketProvider } from "@/adapters/market/queens-cz";
import { sizeerCzMarketProvider } from "@/adapters/market/sizeer-cz";
import type { MarketProvider } from "@/adapters/market/types";

export type ShopIntegrationState = "active" | "partial" | "candidate";
export type ShopTrackingMode = "full-catalog" | "on-demand";

export type ShopRegistryEntry = {
  id: string;
  name: string;
  market: "CZ";
  currency: "CZK";
  state: ShopIntegrationState;
  trackingMode: ShopTrackingMode;
  fullCatalog: boolean;
  priceRefreshMinutes: number | null;
  marketProvider: MarketProvider | null;
  note: string;
};

export const SHOP_REGISTRY: ShopRegistryEntry[] = [
  {
    id: "aboutyou-cz",
    name: "ABOUT YOU",
    market: "CZ",
    currency: "CZK",
    state: "active",
    trackingMode: "full-catalog",
    fullCatalog: true,
    priceRefreshMinutes: 240,
    marketProvider: aboutYouCzMarketProvider,
    note: "Partitioned full-catalog source with coverage-gated publication.",
  },
  {
    id: "zalando-cz",
    name: "Zalando",
    market: "CZ",
    currency: "CZK",
    state: "candidate",
    trackingMode: "on-demand",
    fullCatalog: false,
    priceRefreshMinutes: null,
    marketProvider: null,
    note: "Public pages exist, but automated GitHub-runner search verification currently returns HTTP 403; no price is asserted.",
  },
  {
    id: "footshop-cz",
    name: "Footshop",
    market: "CZ",
    currency: "CZK",
    state: "partial",
    trackingMode: "on-demand",
    fullCatalog: false,
    priceRefreshMinutes: null,
    marketProvider: footshopCzMarketProvider,
    note: "Product sitemap discovery works; PDP verification can be blocked by the storefront, so unverified prices are never asserted.",
  },
  {
    id: "queens-cz",
    name: "Queens",
    market: "CZ",
    currency: "CZK",
    state: "partial",
    trackingMode: "on-demand",
    fullCatalog: false,
    priceRefreshMinutes: null,
    marketProvider: queensCzMarketProvider,
    note: "Product sitemap discovery works; PDP verification can be blocked by the storefront, so unverified prices are never asserted.",
  },
  {
    id: "sizeer-cz",
    name: "Sizeer",
    market: "CZ",
    currency: "CZK",
    state: "candidate",
    trackingMode: "on-demand",
    fullCatalog: false,
    priceRefreshMinutes: null,
    marketProvider: sizeerCzMarketProvider,
    note: "Public collection/PDP provider implemented; promotion to active requires the live smoke gate to pass.",
  },
  {
    id: "eobuv-cz",
    name: "eobuv.cz",
    market: "CZ",
    currency: "CZK",
    state: "candidate",
    trackingMode: "on-demand",
    fullCatalog: false,
    priceRefreshMinutes: null,
    marketProvider: null,
    note: "Public PDP confirmed; search/discovery transport still needs verification.",
  },
  {
    id: "answear-cz",
    name: "Answear",
    market: "CZ",
    currency: "CZK",
    state: "candidate",
    trackingMode: "on-demand",
    fullCatalog: false,
    priceRefreshMinutes: null,
    marketProvider: null,
    note: "Candidate for the next provider wave.",
  },
  {
    id: "buzz-cz",
    name: "Buzz Sneakers",
    market: "CZ",
    currency: "CZK",
    state: "candidate",
    trackingMode: "on-demand",
    fullCatalog: false,
    priceRefreshMinutes: null,
    marketProvider: null,
    note: "Public product catalog confirmed; provider search transport still needs verification.",
  },
];

export const ACTIVE_MARKET_PROVIDERS = SHOP_REGISTRY.flatMap((shop) =>
  (shop.state === "active" || shop.state === "partial") && shop.marketProvider
    ? [shop.marketProvider]
    : [],
);

export function shopIntegrationSummary() {
  return {
    active: SHOP_REGISTRY.filter((shop) => shop.state === "active").length,
    partial: SHOP_REGISTRY.filter((shop) => shop.state === "partial").length,
    candidates: SHOP_REGISTRY.filter((shop) => shop.state === "candidate").length,
    fullCatalog: SHOP_REGISTRY.filter((shop) => shop.fullCatalog).length,
    onDemand: SHOP_REGISTRY.filter((shop) => shop.trackingMode === "on-demand").length,
  };
}
