export type MarketSort = "cheapest" | "recommended";

export type MarketSearchIntent = {
  exactProduct: boolean;
  brand: string | null;
  model: string | null;
  size: string | null;
  sort: MarketSort;
  canonicalKey: string | null;
  queryTerms: string[];
};

type BrandDefinition = {
  name: string;
  aliases: string[];
};

const BRANDS: BrandDefinition[] = [
  { name: "new balance", aliases: ["new balance", "newbalance"] },
  { name: "under armour", aliases: ["under armour", "underarmour"] },
  { name: "the north face", aliases: ["the north face", "north face", "thenorthface"] },
  { name: "calvin klein", aliases: ["calvin klein", "calvinklein"] },
  { name: "tommy hilfiger", aliases: ["tommy hilfiger", "tommyhilfiger"] },
  { name: "dr. martens", aliases: ["dr martens", "dr. martens", "drmartens"] },
  { name: "adidas", aliases: ["adidas originals", "adidas"] },
  { name: "nike", aliases: ["nike"] },
  { name: "jordan", aliases: ["air jordan", "jordan"] },
  { name: "puma", aliases: ["puma"] },
  { name: "reebok", aliases: ["reebok"] },
  { name: "asics", aliases: ["asics"] },
  { name: "vans", aliases: ["vans"] },
  { name: "converse", aliases: ["converse"] },
  { name: "salomon", aliases: ["salomon"] },
  { name: "hoka", aliases: ["hoka"] },
  { name: "on", aliases: ["on running", "on"] },
  { name: "levi's", aliases: ["levis", "levi's", "levi"] },
  { name: "carhartt wip", aliases: ["carhartt wip", "carhartt"] },
  { name: "patagonia", aliases: ["patagonia"] },
  { name: "columbia", aliases: ["columbia"] },
];

const NOISE_TERMS = new Set([
  "nejlevnejsi", "nejlevneji", "nejnizsi", "nejnizsi-cena", "levne", "levneji",
  "cena", "ceny", "cenu", "koupit", "kup", "najdi", "najit", "hledej", "hledam",
  "kde", "prosim", "skladem", "dostupne", "dostupny", "dostupna", "top", "deal",
  "boty", "tenisky", "sneakers", "obuv", "panske", "pansky", "damske", "damsky",
  "velikost", "vel", "size", "cz", "cesko", "cesku", "trh", "trhu",
]);

export function normalizeMarketText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("cs-CZ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9.,+/_ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactMarketText(value: string) {
  return normalizeMarketText(value).replace(/[^a-z0-9]/g, "");
}

function tokenized(value: string) {
  return normalizeMarketText(value)
    .split(/[\s,;/]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function findBrand(normalized: string) {
  const padded = ` ${normalized} `;
  for (const brand of BRANDS) {
    const aliases = [...brand.aliases].sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      const normalizedAlias = normalizeMarketText(alias);
      if (padded.includes(` ${normalizedAlias} `) || compactMarketText(normalized).startsWith(compactMarketText(alias))) {
        return { brand, alias: normalizedAlias };
      }
    }
  }
  return null;
}

function normalizeSize(value: string) {
  return value.toUpperCase().replace(".", ",");
}

function isShoeSize(value: string) {
  return /^(?:3[5-9]|4[0-9]|5[0-2])(?:[.,](?:3|5|7))?$/.test(value);
}

function removeBrandTokens(tokens: string[], alias: string) {
  const aliasTokens = tokenized(alias);
  if (aliasTokens.length === 0) return tokens;

  for (let index = 0; index <= tokens.length - aliasTokens.length; index += 1) {
    const matches = aliasTokens.every((token, offset) => tokens[index + offset] === token);
    if (!matches) continue;
    return [...tokens.slice(0, index), ...tokens.slice(index + aliasTokens.length)];
  }

  const compactAlias = compactMarketText(alias);
  return tokens.filter((token) => compactMarketText(token) !== compactAlias);
}

export function parseMarketSearchIntent(raw: string): MarketSearchIntent {
  const normalized = normalizeMarketText(raw);
  const brandMatch = findBrand(normalized);
  const sort: MarketSort = /nejlevnejs|nejlevneji|nejnizsi\s+cena|nejnizsi\s+cenu/.test(normalized)
    ? "cheapest"
    : "recommended";

  if (!brandMatch) {
    return {
      exactProduct: false,
      brand: null,
      model: null,
      size: null,
      sort,
      canonicalKey: null,
      queryTerms: tokenized(normalized).filter((token) => !NOISE_TERMS.has(token)),
    };
  }

  let terms = removeBrandTokens(tokenized(normalized), brandMatch.alias);
  let size: string | null = null;

  const sizeIndex = terms.findIndex((term, index) => {
    if (!isShoeSize(term)) return false;
    if (index > 0 && terms[index - 1] === "velikost") return true;
    const modelishBefore = terms.slice(0, index).filter((candidate) => !NOISE_TERMS.has(candidate));
    return modelishBefore.length >= 1;
  });
  if (sizeIndex >= 0) {
    size = normalizeSize(terms[sizeIndex]);
    terms = terms.filter((_, index) => index !== sizeIndex);
  }

  const modelTerms = terms
    .filter((term) => !NOISE_TERMS.has(term))
    .filter((term) => !isShoeSize(term) || /^\d{3,}$/.test(term))
    .filter((term) => term.length >= 1);

  const model = modelTerms.join(" ").trim() || null;
  const exactProduct = Boolean(model && compactMarketText(model).length >= 2);
  const canonicalKey = exactProduct
    ? `${compactMarketText(brandMatch.brand.name)}:${compactMarketText(model!)}`
    : null;

  return {
    exactProduct,
    brand: brandMatch.brand.name,
    model,
    size,
    sort,
    canonicalKey,
    queryTerms: modelTerms,
  };
}

export function marketUrlMatchesIntent(url: string, intent: MarketSearchIntent) {
  if (!intent.exactProduct || !intent.brand || !intent.model) return false;
  const compactUrl = compactMarketText(url);
  return compactUrl.includes(compactMarketText(intent.brand))
    && compactUrl.includes(compactMarketText(intent.model));
}

export function marketProductMatchesIntent(
  title: string,
  structuredBrand: string | null,
  intent: MarketSearchIntent,
) {
  if (!intent.exactProduct || !intent.brand || !intent.model) return false;

  const compactTitle = compactMarketText(title);
  const expectedModel = compactMarketText(intent.model);
  if (!compactTitle.includes(expectedModel)) return false;

  const expectedBrand = compactMarketText(intent.brand);
  if (compactTitle.includes(expectedBrand)) return true;

  const actualBrand = compactMarketText(structuredBrand ?? "");
  return Boolean(
    actualBrand
    && (actualBrand.includes(expectedBrand) || expectedBrand.includes(actualBrand)),
  );
}

export function marketTitleMatchesIntent(title: string, intent: MarketSearchIntent) {
  return marketProductMatchesIntent(title, null, intent);
}
