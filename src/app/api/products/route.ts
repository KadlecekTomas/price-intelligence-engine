import { NextResponse } from "next/server";
import { discoveryState } from "@/lib/discovery-state";
import { databaseConfigured, readLatestProducts } from "@/lib/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (databaseConfigured()) {
    try {
      const products = await readLatestProducts(250);
      return NextResponse.json({ products, source: "postgres" });
    } catch (error) {
      console.error("Failed to read persisted products", error);
    }
  }

  return NextResponse.json({ products: discoveryState.products, source: "memory" });
}
