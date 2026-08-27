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
  ["mikina", ["mikina", "mikiny", "hoodie", "sweatshirt"]],
  ["svetr", ["svetr", "svetry", "pulovr", "rolak"]],
  ["košile", ["kosile", "kosili", "shirt"]],
  ["džíny", ["dziny", "dzin", "jeans", "denim"]],
  ["kalhoty", ["kalhoty", "kalhot", "trousers", "pants"]],
  ["bunda", ["bunda", "bundy", "jacket", "parka"]],
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
  ["bavlna", ["bavlna", "bavlny", "cotton"]],
  ["vlna", ["vlna", "vlny", "wool"]],
  ["merino", ["merino"]],
  ["len", ["len", "lnene", "linen"]],
  ["kašmír", ["kasmir", "cashmere"]],
  ["kůže", ["kuze", "kozeny", "leather"]],
  ["polyester", ["polyester"]],
  ["lyocell", ["lyocell", "tencel"]],
  ["modal", ["modal"]],
];

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

function containsAlias(text: string, aliases: string[]) {
  return aliases.some((alias) => text.includes(fold(alias)));
}

function parsePrice(text: string) {
  const thousands = text.match(/(?:do|pod|max(?:imalne)?)?\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:tis(?:ic|ice|icu)?|k)\b/i);
  if (thousands?.[1]) {
    const value = Number(thousands[1].replace(",", ".")) * 1000;
    if (Number.isFinite(value)) return Math.round(value);
  }

  const direct = text.match(/(?:do|pod|max(?:imalne)?)\s*([0-9][0-9 .]*)\s*(?:kc|korun)?/i);
  if (direct?.[1]) {
    const value = Number(direct[1].replace(/[^0-9]/g, ""));
    if (Number.isFinite(value) && value >= 100) return value;
  }

  return null;
}

function parseSize(raw: string) {
  const upper = raw.toUpperCase();
  const apparel = upper.match(/(?:VELIKOST\s*)?\b(XXXL|XXL|XL|XS|L|M|S)\b/);
  if (apparel?.[1]) return apparel[1];

  const waist = upper.match(/\b(W\s?\d{2}(?:\s*[/xX]\s*L?\d{2})?|W\s?\d{2}|L\s?\d{2})\b/);
  if (waist?.[1]) return waist[1].replace(/\s+/g, "");

  const shoe = upper.match(/(?:VELIKOST|BOTY|TENISKY)\s*(3[5-9]|4[0-9]|5[0-2])(?:[.,]5)?\b/);
  return shoe?.[1] ?? null;
}

export function parseNaturalSearch(raw: string): SearchIntent {
  const text = fold(raw);
  const categoryEntry = CATEGORIES.find(([, aliases]) => containsAlias(text, aliases));
  const colorEntry = COLORS.find(([, aliases]) => containsAlias(text, aliases));

  const excludedMaterials: string[] = [];
  const materials: string[] = [];
  for (const [name, aliases] of MATERIALS) {
    if (!containsAlias(text, aliases)) continue;
    const excluded = aliases.some((alias) =>
      new RegExp(`\\bbez(?:\\s+[^ ]+){0,2}\\s+${fold(alias)}[a-z]*\\b`).test(text),
    );
    (excluded ? excludedMaterials : materials).push(name);
  }

  const consumed = new Set<string>();
  for (const [, aliases] of [...CATEGORIES, ...COLORS, ...MATERIALS]) {
    for (const alias of aliases) consumed.add(fold(alias));
  }

  const maxPriceCzk = parsePrice(text);
  const size = parseSize(raw);
  const qualityPreferred = /kvalit|material|prijemn|vydrz|premium/.test(text);
  const sort: SearchSort = /nejlevnejs/.test(text)
    ? "price"
    : /historick|minimu|minimum/.test(text)
      ? "history"
      : /top deal|nejlepsi deal|sleva/.test(text)
        ? "deal"
        : "recommended";

  const requiredTerms = text
    .split(" ")
    .filter((term) => term.length >= 3)
    .filter((term) => !STOP_WORDS.has(term))
    .filter((term) => !consumed.has(term))
    .filter((term) => !/^\d+$/.test(term))
    .filter((term) => !/^(xxxl|xxl|xl|xs|l|m|s|w\d+|l\d+)$/.test(term));

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
    if (intent.categoryTerms.length > 0 && !intent.categoryTerms.some((term) => haystack.includes(term))) continue;
    if (intent.colorTerms.length > 0 && !intent.colorTerms.some((term) => haystack.includes(term))) continue;
    if (intent.materials.length > 0 && !intent.materials.some((material) => haystack.includes(fold(material)))) continue;
    if (intent.excludedMaterials.some((material) => haystack.includes(fold(material)))) continue;
    if (intent.size && !haystack.includes(fold(intent.size))) continue;
    if (intent.requiredTerms.some((term) => !haystack.includes(term))) continue;

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
