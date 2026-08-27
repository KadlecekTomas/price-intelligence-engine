import { NextResponse } from "next/server";
import { parseNaturalSearch, searchProducts } from "@/domain/natural-search";
import { databaseConfigured, readLatestProducts } from "@/lib/database";
import { discoveryState } from "@/lib/discovery-state";
import { readPublicProducts } from "@/lib/supabase-read";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").slice(0, 500);
  const requestedLimit = Number(url.searchParams.get("limit") ?? "36");
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.round(requestedLimit), 60))
    : 36;

  const intent = parseNaturalSearch(query);
  let products = discoveryState.products;
  let source: "postgres" | "memory" = "memory";

  if (databaseConfigured()) {
    try {
      products = await readLatestProducts(500);
      source = "postgres";
    } catch (error) {
      console.error("Search direct DB read failed", error);
    }
  }

  if (source === "memory") {
    try {
      products = await readPublicProducts(500);
      source = "postgres";
    } catch (error) {
      console.error("Search public Supabase read failed, falling back to memory", error);
    }
  }

  const results = searchProducts(products, intent, limit);

  return NextResponse.json({
    query,
    intent,
    results,
    source,
    scannedProducts: products.length,
    resultCount: results.length,
  });
}
