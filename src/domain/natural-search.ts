import { textMatchesRequestedSize } from "@/domain/size-availability";
import type { ScannedProduct } from "@/lib/discovery-state";

export type SearchSort = "recommended" | "price" | "history" | "deal";

export type SearchIntent = {
  original: string;
  category: string | null;
  categoryTerms: string[];
  color: string | null;
  colorTerms: string[];
  size: string | null;
  maxPriceCzk: number | null;
  materials: string[];
  excludedMaterials: string[];
  excludedTerms: string[];
  requiredTerms: string[];
  qualityPreferred: boolean;
  sort: SearchSort;
};

export type SearchResult = {
  product: ScannedProduct;
  searchScore: number;
  recommendation: "BUY_NOW" | "GOOD" | "WAIT" | "FAKE_SALE" | "CHECK";
  reasons: string[];
};

const CATEGORIES: Array<[string, string[]]> = [
  ["tričko", ["tricko", "tricka", "tricek", "t-shirt", "tshirt"]],
  ["mikina", ["mikina", "mikinu", "mikiny", "hoodie", "sweatshirt"]],
  ["svetr", ["svetr", "svetry", "pulovr", "rolak"]],
  ["košile", ["kosile", "kosili", "shirt"]],
  ["džíny", ["dziny", "dzinu", "jeans", "denim"]],
  ["kalhoty", ["kalhoty", "kalhot", "trousers", "pants"]],
  ["bunda", ["bunda", "bundu", "bundy", "jacket", "parka"]],
  ["kabát", ["kabat", "kabaty", "coat"]],
  ["kraťasy", ["kratasy", "sortky", "shorts"]],
  ["polo", ["polo", "polotricko"]],
  ["tenisky", ["tenisky", "sneakers", "sneaker"]],
  ["boty", ["boty", "obuv", "shoes"]],
];

const COLORS: Array<[string, string[]]> = [
  ["černá", ["cerna", "cerne", "cerny", "black"]],
  ["bílá", ["bila", "bile", "bily", "white"]],
  ["modrá", ["modra", "modre", "modry", "navy", "blue"]],
  ["šedá", ["seda", "sede", "sedy", "grey", "gray"]],
  ["zelená", ["zelena", "zelene", "zeleny", "green"]],
  ["béžová", ["bezova", "bezove", "bezovy", "beige"]],
  ["hnědá", ["hneda", "hnede", "hnedy", "brown"]],
  ["červená", ["cervena", "cervene", "cerveny", "red"]],
];

const MATERIALS: Array<[string, string[]]> = [
  ["bavlna", ["bavlna", "bavlny", "bavlnen", "cotton"]],
  ["vlna", ["vlna", "vlny", "vlnen", "wool"]],
  ["merino", ["merino"]],
  ["len", ["len", "lnene", "linene", "linen"]],
  ["kašmír", ["kasmir", "cashmere"]],
  ["kůže", ["kuze", "kozen", "leather"]],
  ["polyester", ["polyester"]],
  ["lyocell", ["lyocell", "tencel"]],
  ["modal", ["modal"]],
];

const NEGATIVE_FEATURES: Array<[string, string[]]> = [
  ["límeček", ["limecek", "limecku", "limeckem", "limec", "collar", "polotricko", "polokosile"]],
  ["logo", ["logo", "loga", "logem", "branding"]],
  ["potisk", ["potisk", "potisku", "potiskem", "print", "graphic"]],
  ["kapuce", ["kapuce", "kapuci", "hood"]],
  ["zip", ["zip", "zipem", "zipper"]],
];

const NEGATION_FILLERS = new Set([
  "velkeho", "velkyho", "vyrazneho", "viditelneho", "maleho", "jakehokoli", "jakehokoliv",
]);

const STOP_WORDS = new Set([
  "chci", "hledam", "najdi", "najit", "ukaz", "ukazat", "mi", "pro", "idealne",
  "nejlepe", "spis", "klidne", "nejaky", "nejake", "nejakou", "panske", "pansky",
  "panskou", "kvalitni", "kvalitne", "levne", "levny", "levna", "top", "deal", "dealy",
  "do", "pod", "max", "maximalne", "kc", "korun", "cena", "ceny", "velikost", "velikosti",
  "bez", "a", "nebo", "s", "se", "na", "v", "ve", "co", "je", "jsou", "aby", "kterou",
  "ktery", "ktere", "historicke", "historickemu", "historickymu", "minimum", "minimu", "nejlevnejsi",
  "tisic", "tisice", "tisicu",
]);

export function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs-CZ")
    .replace(/[^a-z0-9%+\-/ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text: string) {
  return fold(text).split(/[\s/,-]+/).filter(Boolean);
}

function tokenMatchesAlias(token: string, alias: string) {
  const normalized = fold(alias);
  return token === normalized || (normalized.length >= 4 && token.startsWith(normalized));
}

function containsAlias(text: string, aliases: string[]) {
  const tokens = words(text);
  return aliases.some((alias) => tokens.some((token) => tokenMatchesAlias(token, alias)));
}

function materialAliases(name: string) {
  return MATERIALS.find(([material]) => material === name)?.[1] ?? [name];
}

function negativeFeatureAliases(name: string) {
  return NEGATIVE_FEATURES.find(([feature]) => feature === name)?.[1] ?? [name];
}

function normalizePriceText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs-CZ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrice(raw: string) {
  const text = normalizePriceText(raw);
  const thousands = text.match(/(?:do|pod|max(?:imalne)?)?\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:tis(?:ic|ice|icu)?|k)\b/i);
  if (thousands?.[1]) {
    const value = Number(thousands[1].replace(",", ".")) * 1000;
    if (Number.isFinite(value)) return Math.round(value);
  }

  const direct = text.match(/(?:do|pod|max(?:imalne)?)\s*([0-9][0-9 .]*)\s*(?:kc|czk|korun(?:y|a)?)?/i);
  if (direct?.[1]) {
    const value = Number(direct[1].replace(/[^0-9]/g, ""));
    if (Number.isFinite(value) && value >= 100) return value;
  }

  return null;
}

function normalizeSizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\u00a0/g, " ")
    .replace(/[^A-Z0-9.,/X ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSize(raw: string) {
  const normalized = normalizeSizeText(raw);
  const tokens = normalized.split(/[^A-Z0-9]+/).filter(Boolean);
  const apparelSizes = new Set(["XXXL", "XXL", "XL", "XXS", "XS", "L", "M", "S"]);
  const apparel = tokens.find((token) => apparelSizes.has(token));
  if (apparel) return apparel;

  const waist = normalized.match(/(?:^|\s)(W\s?\d{2}(?:\s*[/X]\s*L?\d{2})?|W\s?\d{2}|L\s?\d{2})(?:\s|$)/);
  if (waist?.[1]) {
    return waist[1]
      .replace(/\s+/g, "")
      .replace(/X(?=L?\d{2}$)/, "/")
      .replace(/\/(\d{2})$/, "/L$1");
  }

  const shoe = normalized.match(/(?:VELIKOST|BOTY|TENISKY)\s*((?:3[5-9]|4[0-9]|5[0-2])(?:[.,]5)?)(?:\s|$)/);
  return shoe?.[1]?.replace(".", ",") ?? null;
}

function isExcludedMaterial(text: string, aliases: string[]) {
  const tokens = words(text);
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== "bez") continue;
    const window = tokens.slice(index + 1, index + 4);
    if (aliases.some((alias) => window.some((token) => tokenMatchesAlias(token, alias)))) return true;
  }
  return false;
}

function canonicalNegativeFeature(token: string) {
  return NEGATIVE_FEATURES.find(([, aliases]) =>
    aliases.some((alias) => tokenMatchesAlias(token, alias)),
  )?.[0] ?? token;
}

function tokenIsMaterial(token: string) {
  return MATERIALS.some(([, aliases]) => aliases.some((alias) => tokenMatchesAlias(token, alias)));
}

function parseExcludedTerms(text: string) {
  const tokens = words(text);
  const excludedTerms: string[] = [];
  const negatedTokens = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== "bez") continue;

    for (let offset = 1; offset <= 3; offset += 1) {
      const token = tokens[index + offset];
      if (!token) break;
      if (NEGATION_FILLERS.has(token)) {
        negatedTokens.add(token);
        continue;
      }
      if (STOP_WORDS.has(token)) break;

      negatedTokens.add(token);
      if (!tokenIsMaterial(token)) {
        excludedTerms.push(canonicalNegativeFeature(token));
      }
      break;
    }
  }

  return {
    excludedTerms: [...new Set(excludedTerms)].slice(0, 5),
    negatedTokens,
  };
}

function isConsumedTerm(term: string) {
  const aliases = [...CATEGORIES, ...COLORS, ...MATERIALS].flatMap(([, values]) => values);
  return aliases.some((alias) => tokenMatchesAlias(term, alias));
}

function isCompactPriceToken(term: string) {
  return /^\d+(?:[.,]\d+)?(?:kc|czk|korun|koruny|koruna|k)?$/i.test(term)
    || /^\d+(?:[.,]\d+)?tis(?:ic|ice|icu)?$/i.test(term);
}

function containsRequiredTerm(haystack: string, term: string) {
  return words(haystack).some((token) => token === fold(term));
}

export function parseNaturalSearch(raw: string): SearchIntent {
  const text = fold(raw);
  const categoryEntry = CATEGORIES.find(([, aliases]) => containsAlias(text, aliases));
  const colorEntry = COLORS.find(([, aliases]) => containsAlias(text, aliases));

  const excludedMaterials: string[] = [];
  const materials: string[] = [];
  for (const [name, aliases] of MATERIALS) {
    if (!containsAlias(text, aliases)) continue;
    (isExcludedMaterial(text, aliases) ? excludedMaterials : materials).push(name);
  }

  const { excludedTerms, negatedTokens } = parseExcludedTerms(text);
  const maxPriceCzk = parsePrice(raw);
  const size = parseSize(raw);
  const qualityPreferred = /kvalit|material|prijemn|vydrz|premium/.test(text);
  const sort: SearchSort = /nejlevnejs/.test(text)
    ? "price"
    : /historick|minimu|minimum/.test(text)
      ? "history"
      : /top deal|nejlepsi deal|sleva/.test(text)
        ? "deal"
        : "recommended";

  const requiredTerms = words(text)
    .filter((term) => term.length >= 3)
    .filter((term) => !STOP_WORDS.has(term))
    .filter((term) => !negatedTokens.has(term))
    .filter((term) => !isConsumedTerm(term))
    .filter((term) => !isCompactPriceToken(term))
    .filter((term) => !/^\d+$/.test(term))
    .filter((term) => !/^(xxxl|xxl|xl|xxs|xs|l|m|s|w\d+|l\d+)$/.test(term));

  return {
    original: raw.trim(),
    category: categoryEntry?.[0] ?? null,
    categoryTerms: categoryEntry?.[1].map(fold) ?? [],
    color: colorEntry?.[0] ?? null,
    colorTerms: colorEntry?.[1].map(fold) ?? [],
    size,
    maxPriceCzk,
    materials,
    excludedMaterials,
    excludedTerms,
    requiredTerms: [...new Set(requiredTerms)].slice(0, 5),
    qualityPreferred,
    sort,
  };
}

function productHaystack(product: ScannedProduct) {
  return fold([
    product.text,
    product.material,
    product.color,
    product.fit,
    product.qualitySignals.join(" "),
  ].filter(Boolean).join(" "));
}

function recommendationFor(product: ScannedProduct): SearchResult["recommendation"] {
  if (
    product.discountPct !== null &&
    product.discountPct >= 0.1 &&
    product.ratioToLow !== null &&
    product.ratioToLow >= 1.5
  ) return "FAKE_SALE";

  if ((product.historyScore ?? -1) >= 95 && (product.buyScore ?? product.dealScore ?? -1) >= 78) {
    return "BUY_NOW";
  }
  if ((product.buyScore ?? product.dealScore ?? -1) >= 82) return "GOOD";
  if ((product.ratioToLow ?? 1) >= 1.3) return "WAIT";
  return "CHECK";
}

export function searchProducts(products: ScannedProduct[], intent: SearchIntent, limit = 36): SearchResult[] {
  const results: SearchResult[] = [];

  for (const product of products) {
    const haystack = productHaystack(product);
    if (intent.maxPriceCzk !== null && product.currentPriceCzk > intent.maxPriceCzk) continue;
    if (intent.categoryTerms.length > 0 && !containsAlias(haystack, intent.categoryTerms)) continue;
    if (intent.colorTerms.length > 0 && !containsAlias(haystack, intent.colorTerms)) continue;
    if (intent.materials.length > 0 && !intent.materials.some((material) => containsAlias(haystack, materialAliases(material)))) continue;
    if (intent.excludedMaterials.some((material) => containsAlias(haystack, materialAliases(material)))) continue;
    if (intent.excludedTerms.some((term) => containsAlias(haystack, negativeFeatureAliases(term)))) continue;
    if (intent.size && !textMatchesRequestedSize(product.text, intent.size)) continue;
    if (intent.requiredTerms.some((term) => !containsRequiredTerm(haystack, term))) continue;

    let searchScore = product.buyScore ?? product.dealScore ?? 45;
    const reasons: string[] = [];

    if (product.historyScore !== null && product.historyScore !== undefined) {
      searchScore += product.historyScore * 0.18;
      if (product.historyScore >= 95) reasons.push("blízko našeho historického minima");
    }
    if (product.materialScore !== null && product.materialScore !== undefined) {
      searchScore += product.materialScore * (intent.qualityPreferred ? 0.22 : 0.1);
      if (product.materialScore >= 75) reasons.push("silný materiálový signál");
    }
    if (product.dealScore !== null && product.dealScore >= 90) reasons.push("výborný cenový deal");
    if (product.lowest30dCzk !== null && product.currentPriceCzk <= product.lowest30dCzk * 1.05) {
      reasons.push("do 5 % od 30denního minima");
    }

    results.push({
      product,
      searchScore,
      recommendation: recommendationFor(product),
      reasons: reasons.slice(0, 3),
    });
  }

  return results
    .sort((a, b) => {
      if (intent.sort === "price") return a.product.currentPriceCzk - b.product.currentPriceCzk;
      if (intent.sort === "history") return (b.product.historyScore ?? -1) - (a.product.historyScore ?? -1) || b.searchScore - a.searchScore;
      if (intent.sort === "deal") return (b.product.dealScore ?? -1) - (a.product.dealScore ?? -1) || b.searchScore - a.searchScore;
      return b.searchScore - a.searchScore || a.product.currentPriceCzk - b.product.currentPriceCzk;
    })
    .slice(0, Math.max(1, Math.min(limit, 100)));
}
