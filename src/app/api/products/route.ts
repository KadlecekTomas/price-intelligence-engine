import { NextResponse } from "next/server";
import { discoveryState } from "@/lib/discovery-state";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ products: discoveryState.products });
}
