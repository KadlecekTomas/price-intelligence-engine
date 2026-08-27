import { NextResponse } from "next/server";
import { discoveryState } from "@/lib/discovery-state";
import { databaseConfigured } from "@/lib/database";

export const runtime = "nodejs";

export async function GET() {
  const { candidates: _candidates, products: _products, ...status } = discoveryState;
  const hosted = process.env.VERCEL === "1";
  const postgres = databaseConfigured();

  return NextResponse.json({
    ...status,
    capabilities: {
      scanAvailable: !hosted,
      environment: hosted ? "vercel" : "local",
      persistence: postgres ? "postgres" : "memory-and-local-capture",
    },
  });
}
