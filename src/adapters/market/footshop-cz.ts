import { parseMarketProductPage } from "@/domain/market-product-page";
import type { MarketOffer } from "@/domain/market-offer";
import {
  marketTitleMatchesIntent,
  marketUrlMatchesIntent,
  normalizeMarketText,
  type MarketSearchIntent,
} from "@/domain/market-search";
import type { MarketProvider } from "@/adapters/market/types";

const SHOP_ID = "footshop-cz";
const SHOP_NAME = "Footshop";
const PRODUCT_SITEMAP_URL = "https://sitemaps.footshop.cz/sitemaps/sitemap_products_1_1.xml";
const SITEMAP_TTL_MS = 15 * 60 * 1000;
const MAX_PDP_CANDIDATES = 12;

const HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
  "User-Agent": "PriceIntelligence/0.1 (+https://github.com/KadlecekTomas/price-intelligence-engine)",
};

type SitemapCache = {
  expiresAt: number;
  urls: string[];
};

const globalCache = globalThis as typeof globalThis & {
  __footshopProductSitemap?: SitemapCache;
};

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function parseSitemapUrls(xml: string) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)]
    .map((match) => decodeXml(match[1].trim()))
    .filter((url) => /^https:\/\/www\.footshop\.cz\/cs\//i.test(url));
}

async function fetchProductSitemapUrls() {
  const now = Date.now();
  const cached = globalCache.__footshopProductSitemap;
  if (cached && cached.expiresAt > now) return cached.urls;

  const response = await fetch(PRODUCT_SITEMAP_URL, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Footshop sitemap failed (${response.status})`);

  const xml = await response.text();
  if (xml.length < 50_000) throw new Error("Footshop sitemap response is unexpectedly small");
  const urls = parseSitemapUrls(xml);
  if (urls.length < 1_000) throw new Error(`Footshop sitemap contained only ${urls.length} product URLs`);

  globalCache.__footshopProductSitemap = {
    expiresAt: now + SITEMAP_TTL_MS,
    urls,
  };
  return urls;
}

export function findFootshopCandidateUrls(urls: string[], intent: MarketSearchIntent, limit = MAX_PDP_CANDIDATES) {
  if (!intent.exactProduct) return [];
  return urls
    .filter((url) => marketUrlMatchesIntent(url, intent))
    .slice(0, Math.max(1, Math.min(limit, 24)));
}

function normalizeSize(value: string) {
  return normalizeMarketText(value).toUpperCase().replace(".", ",").replace(/\s+/g, "");
}

function requestedSizeStatus(sizes: string[], requestedSize: string | null): MarketOffer["requestedSizeStatus"] {
  if (!requestedSize) return "unknown";
  if (sizes.length === 0) return "unknown";
  const wanted = normalizeSize(requestedSize);
  return sizes.some((size) => normalizeSize(size) === wanted) ? "available" : "unavailable";
}

async function fetchOffer(url: string, intent: MarketSearchIntent): Promise<MarketOffer | null> {
  const response = await fetch(url, {
    headers: HEADERS,
    next: { revalidate: 180 },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;

  const html = await response.text();
  if (html.length < 5_000) return null;
  const product = parseMarketProductPage(html);
  if (!product || product.availability === "out_of_stock") return null;
  if (!marketTitleMatchesIntent(product.title, intent)) return null;

  const sizeStatus = requestedSizeStatus(product.sizes, intent.size);
  if (sizeStatus === "unavailable") return null;

  const normalizedBrand = normalizeMarketText(product.brand ?? "");
  const expectedBrand = normalizeMarketText(intent.brand ?? "");
  const brandConfirmed = normalizedBrand.includes(expectedBrand) || expectedBrand.includes(normalizedBrand);
  const matchScore = 88
    + (brandConfirmed ? 6 : 0)
    + (product.sku ? 3 : 0)
    + (product.gtin ? 3 : 0);

  return {
    id: `${SHOP_ID}:${product.sku ?? url}`,
    shopId: SHOP_ID,
    shopName: SHOP_NAME,
    url,
    title: product.title,
    brand: product.brand,
    model: intent.model,
    sku: product.sku,
    gtin: product.gtin,
    color: product.color,
    priceCzk: product.priceCzk,
    shippingCzk: null,
    totalPriceCzk: product.priceCzk,
    currency: "CZK",
    availability: product.availability,
    sizes: product.sizes,
    requestedSizeStatus: sizeStatus,
    matchScore: Math.min(100, matchScore),
    source: "sitemap-pdp",
    checkedAt: new Date().toISOString(),
  };
}

async function searchFootshop(intent: MarketSearchIntent) {
  if (!intent.exactProduct) return { offers: [], candidateCount: 0, warning: null };

  const urls = await fetchProductSitemapUrls();
  const candidates = findFootshopCandidateUrls(urls, intent);
  if (candidates.length === 0) {
    return {
      offers: [],
      candidateCount: 0,
      warning: null,
    };
  }

  const settled = await Promise.allSettled(candidates.map((url) => fetchOffer(url, intent)));
  const offers = settled
    .filter((result): result is PromiseFulfilledResult<MarketOffer | null> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((offer): offer is MarketOffer => offer !== null)
    .sort((a, b) => a.totalPriceCzk - b.totalPriceCzk || b.matchScore - a.matchScore);

  const failures = settled.filter((result) => result.status === "rejected").length;
  return {
    offers,
    candidateCount: candidates.length,
    warning: failures > 0
      ? `${failures} Footshop produktových detailů se nepodařilo ověřit; zbytek výsledků je použitelný.`
      : null,
  };
}

export const footshopCzMarketProvider: MarketProvider = {
  id: SHOP_ID,
  name: SHOP_NAME,
  search: searchFootshop,
};
