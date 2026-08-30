import * as cheerio from "cheerio";
import { parseMarketProductPage } from "@/domain/market-product-page";
import type { MarketOffer } from "@/domain/market-offer";
import {
  marketProductMatchesIntent,
  marketUrlMatchesIntent,
  normalizeMarketText,
  type MarketSearchIntent,
} from "@/domain/market-search";
import type { MarketProvider } from "@/adapters/market/types";

const SHOP_ID = "zalando-cz";
const SHOP_NAME = "Zalando";
const ORIGIN = "https://www.zalando.cz";

const HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
  "User-Agent": "PriceIntelligence/0.1 (+https://github.com/KadlecekTomas/price-intelligence-engine)",
};

type OfferCheck = {
  offer: MarketOffer | null;
  reachedProductPage: boolean;
  blocked: boolean;
};

function normalizedSize(value: string) {
  return normalizeMarketText(value).toUpperCase().replace(".", ",").replace(/\s+/g, "");
}

function sizeStatus(sizes: string[], requestedSize: string | null): MarketOffer["requestedSizeStatus"] {
  if (!requestedSize || sizes.length === 0) return "unknown";
  const wanted = normalizedSize(requestedSize);
  return sizes.some((size) => normalizedSize(size) === wanted) ? "available" : "unavailable";
}

export function parseZalandoCatalogCount(html: string) {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const match = text.match(/(\d{1,3}(?:[ .]\d{3})*|\d+)\s+produkt(?:ů|y|u)?/i);
  if (!match) return 0;
  const parsed = Number(match[1].replace(/[ .]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function extractZalandoCandidateUrls(
  html: string,
  intent: MarketSearchIntent,
  limit = 16,
) {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  const bounded = Math.max(1, Math.min(limit, 48));

  $("a[href]").each((_, element) => {
    if (urls.size >= bounded) return;
    const raw = $(element).attr("href");
    if (!raw) return;

    let url: URL;
    try {
      url = new URL(raw, ORIGIN);
    } catch {
      return;
    }
    if (url.origin !== ORIGIN || !/\.html$/i.test(url.pathname)) return;

    const anchorText = $(element).text().replace(/\s+/g, " ").trim();
    const matches = marketUrlMatchesIntent(url.toString(), intent)
      || marketProductMatchesIntent(anchorText, intent.brand, intent);
    if (!matches) return;

    url.search = "";
    url.hash = "";
    urls.add(url.toString());
  });

  return [...urls];
}

function buildSearchUrl(intent: MarketSearchIntent) {
  const query = [intent.brand, intent.model].filter(Boolean).join(" ").trim();
  const url = new URL("/katalog/", ORIGIN);
  url.searchParams.set("q", query);
  return url.toString();
}

async function fetchOffer(url: string, intent: MarketSearchIntent): Promise<OfferCheck> {
  const response = await fetch(url, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(9_000),
  });

  if (!response.ok) {
    return {
      offer: null,
      reachedProductPage: false,
      blocked: [400, 401, 403, 429].includes(response.status),
    };
  }

  const html = await response.text();
  const product = parseMarketProductPage(html);
  if (!product || product.availability === "out_of_stock") {
    return { offer: null, reachedProductPage: true, blocked: false };
  }
  if (!marketProductMatchesIntent(product.title, product.brand, intent)) {
    return { offer: null, reachedProductPage: true, blocked: false };
  }

  const requestedSizeStatus = sizeStatus(product.sizes, intent.size);
  if (requestedSizeStatus === "unavailable") {
    return { offer: null, reachedProductPage: true, blocked: false };
  }

  return {
    reachedProductPage: true,
    blocked: false,
    offer: {
      id: `${SHOP_ID}:${product.sku ?? product.gtin ?? url}`,
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
      requestedSizeStatus,
      matchScore: 97,
      source: "public-search-pdp",
      checkedAt: new Date().toISOString(),
    },
  };
}

export const zalandoCzMarketProvider: MarketProvider = {
  id: SHOP_ID,
  name: SHOP_NAME,
  async search(intent) {
    if (!intent.exactProduct || !intent.brand || !intent.model) {
      return {
        offers: [],
        catalogCount: 0,
        matchedCount: 0,
        checkedCount: 0,
        verification: "catalog-only",
        warning: null,
      };
    }

    const searchUrl = buildSearchUrl(intent);
    const response = await fetch(searchUrl, {
      headers: HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(9_000),
    });
    if (!response.ok) throw new Error(`Zalando catalog search failed (${response.status})`);

    const html = await response.text();
    if (html.length < 10_000) throw new Error("Zalando catalog search returned unexpectedly small HTML");

    const catalogCount = parseZalandoCatalogCount(html);
    const candidates = extractZalandoCandidateUrls(html, intent, 16);
    if (candidates.length === 0) {
      return {
        offers: [],
        catalogCount,
        matchedCount: 0,
        checkedCount: 0,
        verification: "catalog-only",
        warning: null,
      };
    }

    const settled = await Promise.allSettled(candidates.map((url) => fetchOffer(url, intent)));
    const checks = settled
      .filter((result): result is PromiseFulfilledResult<OfferCheck> => result.status === "fulfilled")
      .map((result) => result.value);
    const offers = checks
      .map((check) => check.offer)
      .filter((offer): offer is MarketOffer => offer !== null)
      .sort((a, b) => a.priceCzk - b.priceCzk || b.matchScore - a.matchScore);

    const blockedCount = checks.filter((check) => check.blocked).length;
    const reachedCount = checks.filter((check) => check.reachedProductPage).length;
    const requestFailures = settled.filter((result) => result.status === "rejected").length;
    const verification = blockedCount > 0 && reachedCount === 0
      ? "blocked" as const
      : reachedCount > 0
        ? "live" as const
        : "catalog-only" as const;

    const warning = verification === "blocked"
      ? "Zalando veřejné výsledky jsme našli, ale produktové detaily serverové ověření odmítly. Cenu proto netvrdíme."
      : requestFailures > 0
        ? `${requestFailures} produktových detailů ze Zalanda se nepodařilo ověřit.`
        : null;

    return {
      offers,
      catalogCount,
      matchedCount: candidates.length,
      checkedCount: reachedCount,
      verification,
      warning,
    };
  },
};
