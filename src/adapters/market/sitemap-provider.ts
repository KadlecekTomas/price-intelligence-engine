import { parseMarketProductPage } from "@/domain/market-product-page";
import type { MarketOffer } from "@/domain/market-offer";
import {
  marketProductMatchesIntent,
  marketUrlMatchesIntent,
  normalizeMarketText,
  type MarketSearchIntent,
} from "@/domain/market-search";
import type { MarketProvider } from "@/adapters/market/types";

const SITEMAP_TTL_MS = 15 * 60 * 1000;

const HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
  "User-Agent": "PriceIntelligence/0.1 (+https://github.com/KadlecekTomas/price-intelligence-engine)",
};

type SitemapCacheEntry = {
  expiresAt: number;
  urls: string[];
};

type SitemapProviderConfig = {
  id: string;
  name: string;
  productSitemapUrl: string;
  allowedUrlPrefix: string;
  minProductUrls?: number;
  maxPdpCandidates?: number;
};

type OfferCheck = {
  offer: MarketOffer | null;
  reachedProductPage: boolean;
  blocked: boolean;
};

const globalCache = globalThis as typeof globalThis & {
  __marketSitemapCache?: Map<string, SitemapCacheEntry>;
};

globalCache.__marketSitemapCache ??= new Map();

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function parseProductSitemapUrls(xml: string, allowedUrlPrefix: string) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)]
    .map((match) => decodeXml(match[1].trim()))
    .filter((url) => url.startsWith(allowedUrlPrefix));
}

export function findSitemapCandidateUrls(
  urls: string[],
  intent: MarketSearchIntent,
  limit = 12,
) {
  if (!intent.exactProduct) return [];
  return urls
    .filter((url) => marketUrlMatchesIntent(url, intent))
    .slice(0, Math.max(1, Math.min(limit, 48)));
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

async function fetchSitemapUrls(config: SitemapProviderConfig) {
  const now = Date.now();
  const cache = globalCache.__marketSitemapCache!;
  const cached = cache.get(config.id);
  if (cached && cached.expiresAt > now) return cached.urls;

  const response = await fetch(config.productSitemapUrl, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${config.name} sitemap failed (${response.status})`);

  const xml = await response.text();
  if (xml.length < 50_000) throw new Error(`${config.name} sitemap response is unexpectedly small`);
  const urls = parseProductSitemapUrls(xml, config.allowedUrlPrefix);
  const minimum = config.minProductUrls ?? 500;
  if (urls.length < minimum) {
    throw new Error(`${config.name} sitemap contained only ${urls.length} product URLs`);
  }

  cache.set(config.id, { expiresAt: now + SITEMAP_TTL_MS, urls });
  return urls;
}

async function fetchOffer(
  config: SitemapProviderConfig,
  url: string,
  intent: MarketSearchIntent,
): Promise<OfferCheck> {
  const response = await fetch(url, {
    headers: HEADERS,
    next: { revalidate: 180 },
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    return {
      offer: null,
      reachedProductPage: false,
      blocked: [400, 401, 403, 429].includes(response.status),
    };
  }

  const html = await response.text();
  if (html.length < 5_000) {
    return { offer: null, reachedProductPage: true, blocked: false };
  }

  const product = parseMarketProductPage(html);
  if (!product || product.availability === "out_of_stock") {
    return { offer: null, reachedProductPage: true, blocked: false };
  }
  if (!marketProductMatchesIntent(product.title, product.brand, intent)) {
    return { offer: null, reachedProductPage: true, blocked: false };
  }

  const sizeStatus = requestedSizeStatus(product.sizes, intent.size);
  if (sizeStatus === "unavailable") {
    return { offer: null, reachedProductPage: true, blocked: false };
  }

  const normalizedBrand = normalizeMarketText(product.brand ?? "");
  const expectedBrand = normalizeMarketText(intent.brand ?? "");
  const brandConfirmed = Boolean(
    normalizedBrand && expectedBrand
    && (normalizedBrand.includes(expectedBrand) || expectedBrand.includes(normalizedBrand)),
  );
  const matchScore = 88
    + (brandConfirmed ? 6 : 0)
    + (product.sku ? 3 : 0)
    + (product.gtin ? 3 : 0);

  return {
    reachedProductPage: true,
    blocked: false,
    offer: {
      id: `${config.id}:${product.sku ?? url}`,
      shopId: config.id,
      shopName: config.name,
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
    },
  };
}

export function createSitemapMarketProvider(config: SitemapProviderConfig): MarketProvider {
  return {
    id: config.id,
    name: config.name,
    async search(intent) {
      if (!intent.exactProduct) {
        return {
          offers: [],
          catalogCount: 0,
          matchedCount: 0,
          checkedCount: 0,
          verification: "catalog-only" as const,
          warning: null,
        };
      }

      const urls = await fetchSitemapUrls(config);
      const allMatches = urls.filter((url) => marketUrlMatchesIntent(url, intent));
      const candidates = allMatches.slice(0, Math.max(1, Math.min(config.maxPdpCandidates ?? 12, 48)));
      if (candidates.length === 0) {
        return {
          offers: [],
          catalogCount: urls.length,
          matchedCount: 0,
          checkedCount: 0,
          verification: "catalog-only" as const,
          warning: null,
        };
      }

      const settled = await Promise.allSettled(
        candidates.map((url) => fetchOffer(config, url, intent)),
      );
      const checks = settled
        .filter((result): result is PromiseFulfilledResult<OfferCheck> => result.status === "fulfilled")
        .map((result) => result.value);
      const offers = checks
        .map((check) => check.offer)
        .filter((offer): offer is MarketOffer => offer !== null)
        .sort((a, b) => a.totalPriceCzk - b.totalPriceCzk || b.matchScore - a.matchScore);

      const requestFailures = settled.filter((result) => result.status === "rejected").length;
      const blockedCount = checks.filter((check) => check.blocked).length;
      const reachedCount = checks.filter((check) => check.reachedProductPage).length;
      const verification = blockedCount > 0 && reachedCount === 0
        ? "blocked" as const
        : reachedCount > 0
          ? "live" as const
          : "catalog-only" as const;

      const warning = verification === "blocked"
        ? `${config.name}: aktivní katalog a ${allMatches.length} odpovídajících URL jsme našli, ale obchod odmítl serverové ověření produktových detailů. Cenu proto netvrdíme.`
        : requestFailures > 0
          ? `${requestFailures} produktových detailů z ${config.name} se nepodařilo ověřit.`
          : allMatches.length > candidates.length
            ? `${config.name}: našli jsme ${allMatches.length} odpovídajících URL, ale v tomto requestu jsme ověřili jen ${candidates.length}.`
            : null;

      return {
        offers,
        catalogCount: urls.length,
        matchedCount: allMatches.length,
        checkedCount: reachedCount,
        verification,
        warning,
      };
    },
  };
}
