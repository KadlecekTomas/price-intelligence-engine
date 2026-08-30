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

// Verified from public ABOUT YOU CZ category URLs. Unknown values are never guessed.
const COLOR_IDS: Record<string, string> = {
  "béžová": "38919",
  "modrá": "38920",
  "hnědá": "38921",
  "šedá": "38925",
  "zelená": "38926",
  "červená": "38931",
  "černá": "38932",
  "bílá": "38935",
};

const MATERIAL_STYLE_IDS: Record<string, string> = {
  "bavlna": "35459",
  "vlna": "35462",
};

export type LiveBatchSpec = {
  color: string | null;
  material: string | null;
  confidence: "exact" | "partial" | "broad";
};

export type LiveCatalogResult = {
  sourceUrl: string;
  sourceUrls: string[];
  products: ScannedProduct[];
  fetchedAt: string;
  batchCount: number;
};

function verifiedColor(value: string | null) {
  return value && COLOR_IDS[value] ? value : null;
}

function verifiedMaterial(values: string[]) {
  return values.find((material) => MATERIAL_STYLE_IDS[material]) ?? null;
}

function categoryPath(category: string | null) {
  return category ? CATEGORY_URLS[category] ?? "/c/muzi-20202" : "/c/muzi-20202";
}

export function aboutYouCategoryUrl(
  intent: Pick<SearchIntent, "category" | "color" | "materials">,
  overrides?: { color?: string | null; material?: string | null },
) {
  const url = new URL(categoryPath(intent.category), BASE_URL);
  const color = overrides && "color" in overrides
    ? verifiedColor(overrides.color ?? null)
    : verifiedColor(intent.color);
  const material = overrides && "material" in overrides
    ? overrides.material && MATERIAL_STYLE_IDS[overrides.material] ? overrides.material : null
    : verifiedMaterial(intent.materials);

  if (color) url.searchParams.set("color", COLOR_IDS[color]);
  if (material) url.searchParams.set("materialStyle", MATERIAL_STYLE_IDS[material]);

  return url.toString();
}

function confidenceForBatch(intent: SearchIntent, color: string | null, material: string | null): LiveBatchSpec["confidence"] {
  const wantsColor = Boolean(intent.color);
  const wantsMaterial = intent.materials.length > 0;
  const colorSatisfied = !wantsColor || color === intent.color;
  const materialSatisfied = !wantsMaterial || (material !== null && intent.materials.includes(material));

  if ((wantsColor || wantsMaterial) && colorSatisfied && materialSatisfied) return "exact";
  if (color || material) return "partial";
  return "broad";
}

export function aboutYouLiveBatchSpecs(intent: SearchIntent): LiveBatchSpec[] {
  const color = verifiedColor(intent.color);
  const material = verifiedMaterial(intent.materials);
  const specs: LiveBatchSpec[] = [];

  specs.push({
    color,
    material,
    confidence: confidenceForBatch(intent, color, material),
  });

  if (color && material) {
    specs.push({
      color,
      material: null,
      confidence: confidenceForBatch(intent, color, null),
    });
    specs.push({
      color: null,
      material,
      confidence: confidenceForBatch(intent, null, material),
    });
  }

  if (color || material) {
    specs.push({
      color: null,
      material: null,
      confidence: confidenceForBatch(intent, null, null),
    });
  }

  const seen = new Set<string>();
  return specs.filter((spec) => {
    const key = `${spec.color ?? "*"}|${spec.material ?? "*"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalize(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function readableText(
  $: cheerio.CheerioAPI,
  node: Parameters<cheerio.CheerioAPI>[0],
) {
  const clone = $(node).clone();
  clone.find("br").replaceWith(" ");
  clone.find("*").each((_, child) => {
    $(child).after(" ");
  });
  return normalize(clone.text());
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

function constraintStrength(product: ScannedProduct) {
  let strength = 0;
  if (product.color) strength += 2;
  if (product.qualitySignals.some((signal) => signal.startsWith("ABOUT YOU filtr: materiál="))) strength += 2;
  if (product.qualitySignals.includes("ABOUT YOU live: exact")) strength += 2;
  if (product.qualitySignals.includes("ABOUT YOU live: partial")) strength += 1;
  return strength;
}

export function parseAboutYouCategoryHtml(
  html: string,
  sourceUrl: string,
  knownColor: string | null = null,
  knownMaterialFilter: string | null = null,
  confidence: LiveBatchSpec["confidence"] = "exact",
) {
  const $ = cheerio.load(html);
  const products = new Map<string, ScannedProduct>();

  $('a[href*="/p/"]').each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    const url = canonicalProductUrl(href, sourceUrl);
    if (!url) return;

    let current = $(element);
    let firstPriceText: string | null = null;
    let preferredText: string | null = null;

    for (let depth = 0; depth < 8 && current.length > 0; depth += 1) {
      const candidate = readableText($, current.get(0)!);
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

    const rawText = preferredText ?? firstPriceText ?? readableText($, element);
    const product = parseAboutYouCard(url, rawText);
    if (!product) return;

    if (knownColor) product.color = knownColor;
    if (knownMaterialFilter) {
      product.qualitySignals.push(`ABOUT YOU filtr: materiál=${knownMaterialFilter}`);
    }
    product.qualitySignals.push(`ABOUT YOU live: ${confidence}`);

    const existing = products.get(url);
    if (!existing || constraintStrength(product) > constraintStrength(existing)) {
      products.set(url, product);
    }
  });

  return [...products.values()]
    .sort((a, b) => (b.dealScore ?? -1) - (a.dealScore ?? -1) || a.currentPriceCzk - b.currentPriceCzk)
    .slice(0, 180);
}

async function fetchBatch(intent: SearchIntent, spec: LiveBatchSpec) {
  const sourceUrl = aboutYouCategoryUrl(intent, {
    color: spec.color,
    material: spec.material,
  });
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.6",
    },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(8_000),
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
    products: parseAboutYouCategoryHtml(
      html,
      sourceUrl,
      spec.color,
      spec.material,
      spec.confidence,
    ),
  };
}

export async function fetchLiveAboutYouCatalog(intent: SearchIntent): Promise<LiveCatalogResult> {
  const specs = aboutYouLiveBatchSpecs(intent);
  const settled = await Promise.allSettled(specs.map((spec) => fetchBatch(intent, spec)));
  const successful = settled
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchBatch>>> => result.status === "fulfilled")
    .map((result) => result.value);

  if (successful.length === 0) {
    const firstFailure = settled.find((result) => result.status === "rejected");
    throw firstFailure && firstFailure.status === "rejected"
      ? firstFailure.reason
      : new Error("ABOUT YOU live read failed");
  }

  const products = new Map<string, ScannedProduct>();
  for (const batch of successful) {
    for (const product of batch.products) {
      const existing = products.get(product.id);
      if (
        !existing ||
        constraintStrength(product) > constraintStrength(existing) ||
        (constraintStrength(product) === constraintStrength(existing) && product.text.length > existing.text.length)
      ) {
        products.set(product.id, product);
      }
    }
  }

  return {
    sourceUrl: successful[0].sourceUrl,
    sourceUrls: successful.map((batch) => batch.sourceUrl),
    products: [...products.values()],
    fetchedAt: new Date().toISOString(),
    batchCount: successful.length,
  };
}
