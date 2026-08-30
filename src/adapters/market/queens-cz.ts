import { createSitemapMarketProvider } from "@/adapters/market/sitemap-provider";

export const queensCzMarketProvider = createSitemapMarketProvider({
  id: "queens-cz",
  name: "Queens",
  productSitemapUrl: "https://sitemaps.queens.cz/sitemaps/sitemap_products_1_1.xml",
  allowedUrlPrefix: "https://www.queens.cz/cs/",
  minProductUrls: 8_000,
  maxPdpCandidates: 12,
});
