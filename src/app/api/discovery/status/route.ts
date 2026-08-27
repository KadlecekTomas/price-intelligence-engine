import { NextResponse } from "next/server";
import { discoveryState } from "@/lib/discovery-state";

export const runtime = "nodejs";

export async function GET() {
  const { candidates: _candidates, ...status } = discoveryState;
  return NextResponse.json(status);
}
