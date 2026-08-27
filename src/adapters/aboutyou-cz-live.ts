import * as cheerio from "cheerio";
import type { SearchIntent } from "@/domain/natural-search";
import { parseAboutYouCard } from "@/domain/aboutyou-card";
import type { ScannedProduct } from "@/lib/discovery-state";

const BASE_URL = "https://www.aboutyou.cz";

const CATEGORY_URLS: Record<string, string> = {
  "tričko": "/c/muzi/obleceni/tricka-20324",
  "mikina": "/c/muzi/obleceni/mikiny-20327",
  "svetr": "/c/muzi/obleceni/svetry-kardigany/svetry-20950",
  "košile": "/c/muzi/obleceni/kosile-20319",
  "džíny": "/c/muzi/obleceni/dziny-20331",
  "kalhoty": "/c/muzi/obleceni/kalhoty-20330",
  "bunda": "/c/muzi/obleceni/bundy-20320",
  "kabát": "/c/muzi/obleceni/kabaty-20321",
  "kraťasy": "/c/muzi/obleceni/kalhoty/kratasy-20332",
  "polo": "/c/muzi/obleceni/tricka/polo-tricka-20957",
  "tenisky": "/c/muzi/boty/tenisky-20345",
  "boty": "/c/muzi/boty-20215",
};

export type LiveCatalogResult = {
  sourceUrl: string;
  products: ScannedProduct[];
  fetchedAt: string;
};

export function aboutYouCategoryUrl(intent: Pick<SearchIntent, "category">) {
  const pathname = intent.category ? CATEGORY_URLS[intent.category] : null;
  return new URL(pathname ?? "/c/muzi-20202", BASE_URL).toString();
}

function normalize(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalProductUrl(href: string, sourceUrl: string) {
  try {
    const url = new URL(href, sourceUrl);
    if (url.origin !== BASE_URL || !url.pathname.includes("/p/")) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function parseAboutYouCategoryHtml(html: string, sourceUrl: string) {
  const $ = cheerio.load(html);
  const products = new Map<string, ScannedProduct>();

  $('a[href*="/p/"]').each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    const url = canonicalProductUrl(href, sourceUrl);
    if (!url || products.has(url)) return;

    let current = $(element);
    let firstPriceText: string | null = null;
    let preferredText: string | null = null;

    for (let depth = 0; depth < 8 && current.length > 0; depth += 1) {
      const candidate = normalize(current.text());
      const productLinkCount = current.find('a[href*="/p/"]').length;

      if (
        candidate.length > 0 &&
        candidate.length <= 3_500 &&
        productLinkCount <= 4 &&
        /Kč/i.test(candidate)
      ) {
        firstPriceText ??= candidate;
        if (/Poslední nejnižší cena|Původně:/i.test(candidate)) {
          preferredText = candidate;
          break;
        }
      }

      current = current.parent();
    }

    const rawText = preferredText ?? firstPriceText ?? normalize($(element).text());
    const product = parseAboutYouCard(url, rawText);
    if (product) products.set(url, product);
  });

  return [...products.values()]
    .sort((a, b) => (b.dealScore ?? -1) - (a.dealScore ?? -1) || a.currentPriceCzk - b.currentPriceCzk)
    .slice(0, 160);
}

export async function fetchLiveAboutYouCatalog(intent: SearchIntent): Promise<LiveCatalogResult> {
  const sourceUrl = aboutYouCategoryUrl(intent);
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.6",
    },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`ABOUT YOU live read failed (${response.status})`);
  }

  const html = await response.text();
  if (html.length < 10_000) {
    throw new Error("ABOUT YOU live response is unexpectedly small");
  }

  return {
    sourceUrl,
    products: parseAboutYouCategoryHtml(html, sourceUrl),
    fetchedAt: new Date().toISOString(),
  };
}
