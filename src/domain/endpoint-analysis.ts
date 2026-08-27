import type { EndpointCandidate } from "@/lib/discovery-state";

export type ProductArraySignal = {
  path: string;
  length: number;
  keys: string[];
  score: number;
};

export type NumericTotalSignal = {
  path: string;
  value: number;
};

export type EndpointAnalysis = {
  candidateId: string;
  url: string;
  sampleFile: string;
  httpStatus: number;
  bytes: number;
  networkScore: number;
  structureScore: number;
  totalScore: number;
  likelyBulk: boolean;
  productArrays: ProductArraySignal[];
  paginationKeys: string[];
  commerceKeys: string[];
  numericTotals: NumericTotalSignal[];
};

const PRODUCT_KEY =
  /(^|_)(product|products|id|name|brand|price|prices|variant|variants|sku|reference|category|categories|attribute|attributes|stock|availability)($|_)/i;
const PAGINATION_KEY =
  /(^|_)(page|pages|offset|limit|cursor|next|previous|per_page|perpage|page_size|pagesize|pagination)($|_)/i;
const COMMERCE_KEY =
  /(^|_)(price|prices|currency|variant|variants|stock|availability|size|sizes|brand|category|categories|sale|discount|promotion)($|_)/i;
const TOTAL_KEY =
  /(^|_)(total|total_count|totalcount|total_items|totalitems|count|result_count|resultcount)($|_)/i;

function pathJoin(parent: string, key: string | number) {
  if (typeof key === "number") return `${parent}[${key}]`;
  return parent === "$" ? `$.${key}` : `${parent}.${key}`;
}

function unique(values: string[]) {
  return [...new Set(values)].sort();
}

export function analyzeJsonCandidate(
  candidate: EndpointCandidate,
  payload: unknown,
): EndpointAnalysis {
  const productArrays: ProductArraySignal[] = [];
  const paginationKeys: string[] = [];
  const commerceKeys: string[] = [];
  const numericTotals: NumericTotalSignal[] = [];

  let visited = 0;
  const MAX_VISITED = 8_000;
  const MAX_DEPTH = 9;

  function walk(value: unknown, path: string, depth: number) {
    if (visited >= MAX_VISITED || depth > MAX_DEPTH || value == null) return;
    visited += 1;

    if (Array.isArray(value)) {
      const objectItems = value
        .slice(0, 8)
        .filter((item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
        );

      if (objectItems.length > 0) {
        const keys = unique(objectItems.flatMap((item) => Object.keys(item)));
        const productishKeys = keys.filter((key) => PRODUCT_KEY.test(key));
        const commerceishKeys = keys.filter((key) => COMMERCE_KEY.test(key));

        if (productishKeys.length >= 2 || commerceishKeys.length >= 2) {
          const lengthScore = Math.min(24, Math.log2(Math.max(2, value.length)) * 4);
          const keyScore = Math.min(30, productishKeys.length * 4);
          const commerceScore = Math.min(18, commerceishKeys.length * 3);

          productArrays.push({
            path,
            length: value.length,
            keys: keys.slice(0, 40),
            score: Math.round(lengthScore + keyScore + commerceScore),
          });
        }
      }

      for (let index = 0; index < Math.min(value.length, 12); index += 1) {
        walk(value[index], pathJoin(path, index), depth + 1);
      }
      return;
    }

    if (typeof value !== "object") return;

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = pathJoin(path, key);

      if (PAGINATION_KEY.test(key)) paginationKeys.push(childPath);
      if (COMMERCE_KEY.test(key)) commerceKeys.push(childPath);
      if (TOTAL_KEY.test(key) && typeof child === "number" && Number.isFinite(child)) {
        numericTotals.push({ path: childPath, value: child });
      }

      walk(child, childPath, depth + 1);
    }
  }

  walk(payload, "$", 0);

  productArrays.sort((a, b) => b.score - a.score || b.length - a.length);
  numericTotals.sort((a, b) => b.value - a.value);

  const bestArray = productArrays[0];
  const uniquePagination = unique(paginationKeys).slice(0, 40);
  const uniqueCommerce = unique(commerceKeys).slice(0, 60);
  const largestTotal = numericTotals[0]?.value ?? 0;

  let structureScore = 0;
  if (bestArray) structureScore += Math.min(55, bestArray.score);
  structureScore += Math.min(18, uniquePagination.length * 4);
  structureScore += Math.min(15, uniqueCommerce.length);
  if (largestTotal >= 100) structureScore += 7;
  if (largestTotal >= 10_000) structureScore += 5;

  const totalScore = Math.round(candidate.score * 4 + structureScore);
  const likelyBulk = Boolean(
    bestArray &&
      (bestArray.length >= 12 || largestTotal >= 100) &&
      (uniquePagination.length > 0 || largestTotal >= 1_000),
  );

  return {
    candidateId: candidate.id,
    url: candidate.url,
    sampleFile: candidate.sampleFile,
    httpStatus: candidate.status,
    bytes: candidate.bytes,
    networkScore: candidate.score,
    structureScore,
    totalScore,
    likelyBulk,
    productArrays: productArrays.slice(0, 8),
    paginationKeys: uniquePagination,
    commerceKeys: uniqueCommerce,
    numericTotals: numericTotals.slice(0, 20),
  };
}

export function rankEndpointAnalyses(analyses: EndpointAnalysis[]) {
  return [...analyses].sort((a, b) => {
    if (a.likelyBulk !== b.likelyBulk) return a.likelyBulk ? -1 : 1;
    return b.totalScore - a.totalScore || b.bytes - a.bytes;
  });
}
