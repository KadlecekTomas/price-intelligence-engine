import { NextResponse } from "next/server";
import { fetchLiveAboutYouCatalog } from "@/adapters/aboutyou-cz-live";
import {
  fold,
  parseNaturalSearch,
  searchProducts,
  type SearchIntent,
  type SearchResult,
} from "@/domain/natural-search";
import { applySearchParamOverrides } from "@/domain/search-overrides";
import { sizeAvailabilityFromText } from "@/domain/size-availability";
import { databaseConfigured, readLatestProducts } from "@/lib/database";
import { discoveryState, type ScannedProduct } from "@/lib/discovery-state";
import { readPublicProducts } from "@/lib/supabase-read";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sizeAvailability(product: ScannedProduct, requestedSize: string) {
  return sizeAvailabilityFromText(product.text, requestedSize);
}

function downgradeForUnverifiedConstraint(
  result: SearchResult,
  reason: string,
  penalty = 7,
): SearchResult {
  const reasons = result.reasons.includes(reason)
    ? result.reasons
    : [reason, ...result.reasons].slice(0, 3);

  return {
    ...result,
    searchScore: result.searchScore - penalty,
    recommendation: "CHECK",
    reasons,
  };
}

function productConfirmsMaterial(product: ScannedProduct, requestedMaterials: string[]) {
  if (requestedMaterials.length === 0) return true;
  const haystack = fold([
    product.material,
    ...product.qualitySignals,
  ].filter(Boolean).join(" "));
  return requestedMaterials.some((material) => haystack.includes(fold(material)));
}

function liveConfidenceBonus(product: ScannedProduct) {
  if (product.qualitySignals.includes("ABOUT YOU live: exact")) return 6;
  if (product.qualitySignals.includes("ABOUT YOU live: partial")) return 2;
  return 0;
}

function dedupeResults(results: SearchResult[], limit: number) {
  const byId = new Map<string, SearchResult>();
  for (const result of results) {
    const existing = byId.get(result.product.id);
    if (!existing || result.searchScore > existing.searchScore) byId.set(result.product.id, result);
  }
  return [...byId.values()]
    .sort((a, b) => b.searchScore - a.searchScore || a.product.currentPriceCzk - b.product.currentPriceCzk)
    .slice(0, limit);
}

function buildNearMatches(
  products: ScannedProduct[],
  intent: SearchIntent,
  limit: number,
): SearchResult[] {
  const relaxedBudget = intent.maxPriceCzk === null
    ? null
    : Math.ceil((intent.maxPriceCzk * 1.3) / 10) * 10;

  const relaxedIntent: SearchIntent = {
    ...intent,
    color: null,
    colorTerms: [],
    size: null,
    materials: [],
    excludedMaterials: [],
    excludedTerms: [],
    maxPriceCzk: relaxedBudget,
  };

  return searchProducts(products, relaxedIntent, Math.max(24, limit * 3))
    .filter((result) => !intent.size || sizeAvailability(result.product, intent.size) !== "no")
    .map((result) => {
      const reasons: string[] = [];

      if (intent.maxPriceCzk !== null && result.product.currentPriceCzk > intent.maxPriceCzk) {
        reasons.push(`${result.product.currentPriceCzk - intent.maxPriceCzk} Kč nad rozpočet`);
      }

      if (intent.size && sizeAvailability(result.product, intent.size) === "unknown") {
        reasons.push(`velikost ${intent.size} ověř na detailu`);
      }

      if (intent.color) {
        if (result.product.color && result.product.color !== intent.color) {
          reasons.push(`barva je ${result.product.color}, hledáš ${intent.color}`);
        } else if (!result.product.color) {
          reasons.push(`barvu ${intent.color} ověř na detailu`);
        }
      }

      if (intent.materials.length > 0 && !productConfirmsMaterial(result.product, intent.materials)) {
        reasons.push(`materiál ${intent.materials.join(" / ")} ověř na detailu`);
      }

      if (intent.excludedTerms.length > 0) {
        reasons.push(`bez ${intent.excludedTerms.join(" / ")} ověř na detailu`);
      }

      if (intent.excludedMaterials.length > 0) {
        reasons.push("vyloučený materiál ověř na detailu");
      }

      return {
        ...result,
        searchScore: result.searchScore - 20,
        recommendation: "CHECK" as const,
        reasons: [...reasons, ...result.reasons].slice(0, 3),
      };
    })
    .sort((a, b) => {
      const aOverBudget = intent.maxPriceCzk === null
        ? 0
        : Math.max(0, a.product.currentPriceCzk - intent.maxPriceCzk);
      const bOverBudget = intent.maxPriceCzk === null
        ? 0
        : Math.max(0, b.product.currentPriceCzk - intent.maxPriceCzk);
      return aOverBudget - bOverBudget || b.searchScore - a.searchScore;
    })
    .slice(0, limit);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").slice(0, 500);
  const requestedLimit = Number(url.searchParams.get("limit") ?? "36");
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.round(requestedLimit), 60))
    : 36;

  const intent = applySearchParamOverrides(parseNaturalSearch(query), url.searchParams);
  let persistedProducts = discoveryState.products;
  let persistedSource: "postgres" | "memory" = "memory";

  if (databaseConfigured()) {
    try {
      persistedProducts = await readLatestProducts(500);
      persistedSource = "postgres";
    } catch (error) {
      console.error("Search direct DB read failed", error);
    }
  }

  if (persistedSource === "memory") {
    try {
      persistedProducts = await readPublicProducts(500);
      persistedSource = "postgres";
    } catch (error) {
      console.error("Search public Supabase read failed, falling back to memory", error);
    }
  }

  const persistedResults = searchProducts(persistedProducts, intent, limit);
  const desiredPersistedResults = Math.min(12, limit);

  let results = persistedResults;
  let nearMatches: SearchResult[] = [];
  let source: "postgres" | "memory" | "live-aboutyou" | "hybrid" = persistedSource;
  let liveSourceUrl: string | null = null;
  let liveSourceUrls: string[] = [];
  let liveFetchedAt: string | null = null;
  let liveProducts = 0;
  let liveBatches = 0;
  let liveProductIds: string[] = [];
  const warnings: string[] = [];

  if (persistedResults.length < desiredPersistedResults) {
    try {
      const live = await fetchLiveAboutYouCatalog(intent);
      liveSourceUrl = live.sourceUrl;
      liveSourceUrls = live.sourceUrls;
      liveFetchedAt = live.fetchedAt;
      liveProducts = live.products.length;
      liveProductIds = live.products.map((product) => product.id);
      liveBatches = live.batchCount;

      // The live adapter already narrows the public category by verified ABOUT YOU filters.
      // Search the union more permissively so partial/broad batches can fill the shortlist,
      // then explicitly mark any unverified constraint instead of pretending it is known.
      const liveIntent: SearchIntent = {
        ...intent,
        color: null,
        colorTerms: [],
        size: null,
        materials: [],
        excludedMaterials: [],
      };

      let liveResults = searchProducts(live.products, liveIntent, 100).map((result) => ({
        ...result,
        searchScore: result.searchScore + liveConfidenceBonus(result.product),
      }));

      if (intent.size) {
        liveResults = liveResults
          .filter((result) => sizeAvailability(result.product, intent.size!) !== "no")
          .map((result) => {
            const availability = sizeAvailability(result.product, intent.size!);
            return availability === "unknown"
              ? downgradeForUnverifiedConstraint(result, `velikost ${intent.size} ověř na detailu`, 4)
              : result;
          });
      }

      if (intent.color) {
        liveResults = liveResults.map((result) =>
          result.product.color === intent.color
            ? result
            : downgradeForUnverifiedConstraint(result, `barvu ${intent.color} ověř na detailu`, 9),
        );
      }

      if (intent.materials.length > 0) {
        liveResults = liveResults.map((result) =>
          productConfirmsMaterial(result.product, intent.materials)
            ? result
            : downgradeForUnverifiedConstraint(result, "materiál ověř na detailu", 9),
        );
      }

      if (intent.excludedMaterials.length > 0) {
        warnings.push("Vyloučený materiál nelze z veřejné produktové karty garantovat; živé kandidáty proto označujeme k prověření.");
        liveResults = liveResults.map((result) =>
          downgradeForUnverifiedConstraint(result, "složení materiálu ověř na detailu", 8),
        );
      }

      if (intent.excludedTerms.length > 0) {
        warnings.push(`Podmínku „bez ${intent.excludedTerms.join(" / ")}“ umíme z produktové karty vyloučit, když je prvek výslovně uvedený; u ostatních kandidátů ji označujeme k ověření.`);
        liveResults = liveResults.map((result) =>
          downgradeForUnverifiedConstraint(
            result,
            `bez ${intent.excludedTerms.join(" / ")} ověř na detailu`,
            5,
          ),
        );
      }

      if (live.batchCount > 1) {
        warnings.push(`Pro větší pokrytí jsme spojili ${live.batchCount} veřejné výřezy stejné ABOUT YOU kategorie; přesnější výřezy dostávají vyšší skóre a neověřené podmínky vždy označujeme.`);
      }

      results = dedupeResults([...persistedResults, ...liveResults], limit);
      if (results.length === 0) {
        nearMatches = buildNearMatches(live.products, intent, Math.min(8, limit));
      }
      source = persistedProducts.length > 0 ? "hybrid" : "live-aboutyou";
    } catch (error) {
      console.error("Live ABOUT YOU fallback failed", error);
      if (persistedResults.length === 0) {
        warnings.push("Živý storefront se teď nepodařilo načíst. Zkus vyhledávání znovu za chvíli.");
      }
    }
  }

  const uniqueCandidateCount = new Set([
    ...persistedProducts.map((product) => product.id),
    ...liveProductIds,
  ]).size;

  return NextResponse.json({
    query,
    intent,
    results,
    nearMatches,
    source,
    scannedProducts: uniqueCandidateCount,
    persistedProducts: persistedProducts.length,
    liveProducts,
    liveBatches,
    resultCount: results.length,
    nearMatchCount: nearMatches.length,
    liveSourceUrl,
    liveSourceUrls,
    liveFetchedAt,
    warnings,
  });
}
