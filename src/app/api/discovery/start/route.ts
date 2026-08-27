import { NextResponse } from "next/server";
import { discoveryState } from "@/lib/discovery-state";

export const runtime = "nodejs";

export async function POST() {
  if (process.env.VERCEL === "1") {
    return NextResponse.json(
      {
        ok: false,
        reason: "local-only",
        message:
          "Playwright discovery runs locally. The hosted Vercel dashboard will consume persisted data once the worker/database layer is connected.",
      },
      { status: 409 },
    );
  }

  if (discoveryState.running) {
    return NextResponse.json({ ok: false, reason: "already-running" }, { status: 409 });
  }

  const { runAboutYouDiscovery } = await import("@/lib/discovery-runner");
  void runAboutYouDiscovery();
  return NextResponse.json({ ok: true }, { status: 202 });
}
