import { parseNaturalSearch, type SearchIntent, type SearchSort } from "@/domain/natural-search";

const SORTS = new Set<SearchSort>(["recommended", "price", "history", "deal"]);

function normalizedSize(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(".", ",").replace(/\s+/g, "");
  if (/^(XXS|XS|S|M|L|XL|XXL|XXXL)$/.test(normalized)) return normalized;
  if (/^(?:3[5-9]|4[0-9]|5[0-2])(?:,5)?$/.test(normalized)) return normalized;
  if (/^W\d{2}(?:\/L?\d{2})?$/.test(normalized)) {
    return normalized.replace(/\/(\d{2})$/, "/L$1");
  }
  return null;
}

function finitePrice(value: string | null) {
  if (!value) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 100 || parsed > 1_000_000) return null;
  return Math.round(parsed);
}

export function applySearchParamOverrides(intent: SearchIntent, params: URLSearchParams): SearchIntent {
  let next = { ...intent };

  const category = params.get("category");
  if (category) {
    const parsed = parseNaturalSearch(category);
    if (parsed.category) {
      next = {
        ...next,
        category: parsed.category,
        categoryTerms: parsed.categoryTerms,
      };
    }
  }

  const color = params.get("color");
  if (color) {
    const parsed = parseNaturalSearch(color);
    if (parsed.color) {
      next = {
        ...next,
        color: parsed.color,
        colorTerms: parsed.colorTerms,
      };
    }
  }

  const material = params.get("material");
  if (material) {
    const parsed = parseNaturalSearch(material);
    if (parsed.materials.length > 0) {
      next = {
        ...next,
        materials: parsed.materials,
        excludedMaterials: next.excludedMaterials.filter(
          (excluded) => !parsed.materials.includes(excluded),
        ),
      };
    }
  }

  const size = normalizedSize(params.get("size"));
  if (size) next = { ...next, size };

  const maxPriceCzk = finitePrice(params.get("maxPrice"));
  if (maxPriceCzk !== null) next = { ...next, maxPriceCzk };

  const sort = params.get("sort") as SearchSort | null;
  if (sort && SORTS.has(sort)) next = { ...next, sort };

  const quality = params.get("quality");
  if (quality === "1" || quality === "true") next = { ...next, qualityPreferred: true };
  if (quality === "0" || quality === "false") next = { ...next, qualityPreferred: false };

  return next;
}
