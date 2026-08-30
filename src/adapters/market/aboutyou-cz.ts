import { parseAboutYouCategoryHtml } from "@/adapters/aboutyou-cz-live";
import type { MarketProvider } from "@/adapters/market/types";
import type { MarketOffer } from "@/domain/market-offer";
import { marketProductMatchesIntent, type MarketSearchIntent } from "@/domain/market-search";
import { sizeAvailabilityFromText } from "@/domain/size-availability";
import type { ScannedProduct } from "@/lib/discovery-state";

const SHOP_ID = "aboutyou-cz";
const SHOP_NAME = "ABOUT YOU";

const BRAND_LISTINGS: Record<string, string[]> = {
  puma: [
    "https://www.aboutyou.cz/c/muzi/boty/tenisky-20345?brand=puma-182",
  ],
  adidas: [
    "https://www.aboutyou.cz/c/muzi/boty/tenisky-20345?brand=adidas-originals-290",
    "https://www.aboutyou.cz/c/muzi/boty/tenisky-20345?brand=adidas-187",
  ],
  nike: [
    "https://www.aboutyou.cz/c/muzi/boty/tenisky-20345?brand=nike-272",
    "https://www.aboutyou.cz/c/muzi/boty/tenisky-20345?brand=nike-sportswear-53709",
  ],
};

const HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.6",
};

function cleanTitle(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+(?:Původně:|Poslední nejnižší cena:).*$/i, "")
    .replace(/\s+[0-9][0-9\s.]*\s*Kč.*$/i, "")
    .replace(/^(?:(?:DEAL|VÝPRODEJ|OSOBNÍ KUPÓN|NOVÉ|EXKLUZIVNĚ|PRÉMIUM)\s+)+/i, "")
    .trim()
    .slice(0, 180);
}

function sizeStatus(product: ScannedProduct, intent: MarketSearchIntent): MarketOffer["requestedSizeStatus"] {
  if (!intent.size) return "unknown";
  const status = sizeAvailabilityFromText(product.text, intent.size);
  if (status === "yes") return "available";
  if (status === "no") return "unavailable";
  return "unknown";
}

async function fetchListing(url: string) {
  const response = await fetch(url, {
    headers: HEADERS,
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`ABOUT YOU market listing failed (${response.status})`);

  const html = await response.text();
  if (html.length < 10_000) throw new Error("ABOUT YOU market listing is unexpectedly small");
  return parseAboutYouCategoryHtml(html, url, null, null, "broad");
}

function dedupeProducts(products: ScannedProduct[]) {
  const byId = new Map<string, ScannedProduct>();
  for (const product of products) {
    const existing = byId.get(product.id);
    if (!existing || product.text.length > existing.text.length) byId.set(product.id, product);
  }
  return [...byId.values()];
}

function toOffer(product: ScannedProduct, intent: MarketSearchIntent): MarketOffer | null {
  const title = cleanTitle(product.text);
  if (!marketProductMatchesIntent(title, intent.brand, intent)) return null;

  const requestedSizeStatus = sizeStatus(product, intent);
  if (requestedSizeStatus === "unavailable") return null;

  return {
    id: `${SHOP_ID}:${product.id}`,
    shopId: SHOP_ID,
    shopName: SHOP_NAME,
    url: product.url,
    title,
    brand: intent.brand,
    model: intent.model,
    sku: product.itemNumber,
    gtin: null,
    color: product.color,
    priceCzk: product.currentPriceCzk,
    shippingCzk: null,
    totalPriceCzk: product.currentPriceCzk,
    currency: "CZK",
    availability: "unknown",
    sizes: [],
    requestedSizeStatus,
    matchScore: requestedSizeStatus === "available" ? 96 : 92,
    source: "catalog-index",
    checkedAt: new Date().toISOString(),
  };
}

export const aboutYouCzMarketProvider: MarketProvider = {
  id: SHOP_ID,
  name: SHOP_NAME,
  async search(intent) {
    if (!intent.exactProduct || !intent.brand) {
      return {
        offers: [],
        catalogCount: 0,
        matchedCount: 0,
        checkedCount: 0,
        verification: "catalog-only",
        warning: null,
      };
    }

    const urls = BRAND_LISTINGS[intent.brand];
    if (!urls) {
      return {
        offers: [],
        catalogCount: 0,
        matchedCount: 0,
        checkedCount: 0,
        verification: "catalog-only",
        warning: `ABOUT YOU: pro značku ${intent.brand} ještě nemáme ověřený veřejný market listing.`,
      };
    }

    const settled = await Promise.allSettled(urls.map(fetchListing));
    const successful = settled
      .filter((result): result is PromiseFulfilledResult<ScannedProduct[]> => result.status === "fulfilled")
      .flatMap((result) => result.value);

    if (successful.length === 0) {
      throw new Error("ABOUT YOU market listings are unavailable");
    }

    const products = dedupeProducts(successful);
    const matched = products.filter((product) => {
      const title = cleanTitle(product.text);
      return marketProductMatchesIntent(title, intent.brand, intent);
    });
    const offers = matched
      .map((product) => toOffer(product, intent))
      .filter((offer): offer is MarketOffer => offer !== null)
      .sort((a, b) => a.priceCzk - b.priceCzk || b.matchScore - a.matchScore);

    const failedListings = settled.filter((result) => result.status === "rejected").length;
    const coverageWarning = "ABOUT YOU market ceny jsou ověřené z veřejného server-rendered výřezu značky; nejde ještě o kompletní full-catalog sync.";
    const warning = failedListings > 0
      ? `${coverageWarning} ${failedListings} brand listing se nepodařilo načíst.`
      : coverageWarning;

    return {
      offers,
      catalogCount: products.length,
      matchedCount: matched.length,
      checkedCount: matched.length,
      verification: "live",
      warning,
    };
  },
};
