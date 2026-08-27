import { NextResponse } from "next/server";
import { fetchLiveAboutYouCatalog } from "@/adapters/aboutyou-cz-live";
import { fold, parseNaturalSearch, searchProducts, type SearchResult } from "@/domain/natural-search";
import { databaseConfigured, readLatestProducts } from "@/lib/database";
import { discoveryState, type ScannedProduct } from "@/lib/discovery-state";
import { readPublicProducts } from "@/lib/supabase-read";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sizeAvailability(product: ScannedProduct, requestedSize: string) {
  const text = fold(product.text);
  const target = fold(requestedSize);
  const explicit = text.match(/dostupne velikosti:\s*(.*?)(?:pridat do kosiku|puvodne:|posledni nejnizsi cena:|$)/i)?.[1];

  if (explicit) {
    const sizes = explicit.split(/[,;/ ]+/).map((value) => value.trim()).filter(Boolean);
    return sizes.includes(target) ? "yes" : "no";
  }

  if (/dostupne v mnoha velikostech/.test(text)) return "unknown";
  return "unknown";
}

function downgradeForUnverifiedConstraint(result: SearchResult, reason: string): SearchResult {
  if (result.reasons.includes(reason)) return result;
  return {
    ...result,
    recommendation: "CHECK",
    reasons: [reason, ...result.reasons].slice(0, 3),
  };
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").slice(0, 500);
  const requestedLimit = Number(url.searchParams.get("limit") ?? "36");
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.round(requestedLimit), 60))
    : 36;

  const intent = parseNaturalSearch(query);
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
  let source: "postgres" | "memory" | "live-aboutyou" | "hybrid" = persistedSource;
  let liveSourceUrl: string | null = null;
  let liveFetchedAt: string | null = null;
  let liveProducts = 0;
  const warnings: string[] = [];

  if (persistedResults.length < desiredPersistedResults) {
    try {
      const live = await fetchLiveAboutYouCatalog(intent);
      liveSourceUrl = live.sourceUrl;
      liveFetchedAt = live.fetchedAt;
      liveProducts = live.products.length;

      const liveIntent = {
        ...intent,
        size: null,
        excludedMaterials: [],
        materials: live.appliedMaterial ? intent.materials : [],
      };

      let liveResults = searchProducts(live.products, liveIntent, Math.max(limit, 48));

      if (intent.size) {
        liveResults = liveResults.filter((result) => {
          const availability = sizeAvailability(result.product, intent.size!);
          return availability !== "no";
        }).map((result) => {
          const availability = sizeAvailability(result.product, intent.size!);
          return availability === "unknown"
            ? downgradeForUnverifiedConstraint(result, `velikost ${intent.size} ověř na detailu`)
            : result;
        });
      }

      if (intent.materials.length > 0 && !live.appliedMaterial) {
        warnings.push("Požadovaný materiál není na veřejné kategorii spolehlivě filtrovatelný; u živých výsledků ho ověřujeme až po detailním syncu.");
        liveResults = liveResults.map((result) =>
          downgradeForUnverifiedConstraint(result, "materiál zatím není ověřený"),
        );
      }

      if (intent.excludedMaterials.length > 0) {
        warnings.push("Vyloučený materiál nelze z produktové karty garantovat; živé kandidáty proto označujeme k prověření.");
        liveResults = liveResults.map((result) =>
          downgradeForUnverifiedConstraint(result, "složení materiálu ověř na detailu"),
        );
      }

      results = dedupeResults([...persistedResults, ...liveResults], limit);
      source = persistedProducts.length > 0 ? "hybrid" : "live-aboutyou";
    } catch (error) {
      console.error("Live ABOUT YOU fallback failed", error);
      if (persistedResults.length === 0) {
        warnings.push("Živý storefront se teď nepodařilo načíst. Zkus vyhledávání znovu za chvíli.");
      }
    }
  }

  return NextResponse.json({
    query,
    intent,
    results,
    source,
    scannedProducts: persistedProducts.length + liveProducts,
    persistedProducts: persistedProducts.length,
    liveProducts,
    resultCount: results.length,
    liveSourceUrl,
    liveFetchedAt,
    warnings,
  });
}
