import {
  createSitemapMarketProvider,
  findSitemapCandidateUrls,
  parseProductSitemapUrls,
} from "@/adapters/market/sitemap-provider";
import type { MarketSearchIntent } from "@/domain/market-search";

const URL_PREFIX = "https://www.footshop.cz/cs/";

export function parseSitemapUrls(xml: string) {
  return parseProductSitemapUrls(xml, URL_PREFIX);
}

export function findFootshopCandidateUrls(urls: string[], intent: MarketSearchIntent, limit = 12) {
  return findSitemapCandidateUrls(urls, intent, limit);
}

export const footshopCzMarketProvider = createSitemapMarketProvider({
  id: "footshop-cz",
  name: "Footshop",
  productSitemapUrl: "https://sitemaps.footshop.cz/sitemaps/sitemap_products_1_1.xml",
  allowedUrlPrefix: URL_PREFIX,
  minProductUrls: 10_000,
  maxPdpCandidates: 12,
});
