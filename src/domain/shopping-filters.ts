import type { ScannedProduct } from "@/lib/discovery-state";

export type ShoppingFilters = {
  maxPriceCzk: number | null;
  minBuyScore: number | null;
  minHistoryScore: number | null;
  contains: string | null;
  size: string | null;
  limit: number;
};

export const defaultShoppingFilters: ShoppingFilters = {
  maxPriceCzk: null,
  minBuyScore: null,
  minHistoryScore: null,
  contains: null,
  size: null,
  limit: 20,
};

function positiveNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalized(value: string) {
  return value.toLocaleLowerCase("cs-CZ").normalize("NFKC");
}

export function parseShoppingFilters(args: string[]): ShoppingFilters {
  const filters = { ...defaultShoppingFilters };

  for (const arg of args) {
    const [rawKey, ...valueParts] = arg.split("=");
    const value = valueParts.join("=").trim();
    const key = rawKey.trim();

    if (key === "--max-price") {
      filters.maxPriceCzk = positiveNumber(value);
    } else if (key === "--min-buy") {
      filters.minBuyScore = positiveNumber(value);
    } else if (key === "--min-history") {
      filters.minHistoryScore = positiveNumber(value);
    } else if (key === "--contains") {
      filters.contains = value || null;
    } else if (key === "--size") {
      filters.size = value || null;
    } else if (key === "--limit") {
      const parsed = positiveNumber(value);
      if (parsed !== null) filters.limit = Math.max(1, Math.min(100, Math.floor(parsed)));
    }
  }

  return filters;
}

export function matchesShoppingFilters(product: ScannedProduct, filters: ShoppingFilters) {
  if (filters.maxPriceCzk !== null && product.currentPriceCzk > filters.maxPriceCzk) {
    return false;
  }

  const effectiveBuyScore = product.buyScore ?? product.dealScore;
  if (
    filters.minBuyScore !== null &&
    (effectiveBuyScore === null || effectiveBuyScore < filters.minBuyScore)
  ) {
    return false;
  }

  if (
    filters.minHistoryScore !== null &&
    (product.historyScore == null || product.historyScore < filters.minHistoryScore)
  ) {
    return false;
  }

  const searchable = normalized(
    [product.text, product.material, product.fit, product.color, ...product.qualitySignals]
      .filter(Boolean)
      .join(" "),
  );

  if (filters.contains && !searchable.includes(normalized(filters.contains))) {
    return false;
  }

  if (filters.size) {
    const size = normalized(filters.size).replace(/\s+/g, "");
    const compact = searchable.replace(/\s+/g, "");
    const tokens = compact.split(/[,;|/]+/);
    const sizePattern = new RegExp(`(?:^|[^a-z0-9])${size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`, "i");

    if (!tokens.includes(size) && !sizePattern.test(searchable)) {
      return false;
    }
  }

  return true;
}

export function filterAndRankProducts(
  products: ScannedProduct[],
  filters: ShoppingFilters,
) {
  return [...products]
    .filter((product) => matchesShoppingFilters(product, filters))
    .sort((a, b) => {
      const aScore = a.buyScore ?? a.dealScore ?? -1;
      const bScore = b.buyScore ?? b.dealScore ?? -1;
      const aHistory = a.historyScore ?? -1;
      const bHistory = b.historyScore ?? -1;

      return (
        bScore - aScore ||
        bHistory - aHistory ||
        a.currentPriceCzk - b.currentPriceCzk
      );
    })
    .slice(0, filters.limit);
}
