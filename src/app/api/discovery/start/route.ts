import { NextResponse } from "next/server";
import { runAboutYouDiscovery } from "@/lib/discovery-runner";
import { discoveryState } from "@/lib/discovery-state";

export const runtime = "nodejs";

export async function POST() {
  if (discoveryState.running) {
    return NextResponse.json({ ok: false, reason: "already-running" }, { status: 409 });
  }

  void runAboutYouDiscovery();
  return NextResponse.json({ ok: true }, { status: 202 });
}
