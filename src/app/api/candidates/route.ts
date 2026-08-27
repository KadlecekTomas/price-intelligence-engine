import { NextResponse } from "next/server";
import { discoveryState } from "@/lib/discovery-state";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    runId: discoveryState.runId,
    candidates: discoveryState.candidates,
  });
}
