import { NextResponse } from "next/server";
import { discoveryState } from "@/lib/discovery-state";
import { databaseConfigured, readLatestProducts } from "@/lib/database";
import { readPublicProducts } from "@/lib/supabase-read";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (databaseConfigured()) {
    try {
      const products = await readLatestProducts(250);
      return NextResponse.json({ products, source: "postgres" });
    } catch (error) {
      console.error("Failed to read direct persisted products", error);
    }
  }

  try {
    const products = await readPublicProducts(250);
    return NextResponse.json({ products, source: "postgres" });
  } catch (error) {
    console.error("Failed to read public persisted products", error);
  }

  return NextResponse.json({ products: discoveryState.products, source: "memory" });
}
