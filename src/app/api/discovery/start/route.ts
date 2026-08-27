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
          "Playwright discovery runs locally. The hosted Vercel dashboard consumes persisted PostgreSQL data when DATABASE_URL is configured.",
      },
      { status: 409 },
    );
  }

  if (discoveryState.running) {
    return NextResponse.json({ ok: false, reason: "already-running" }, { status: 409 });
  }

  const { runAboutYouDiscovery } = await import("@/lib/discovery-runner");

  void runAboutYouDiscovery()
    .then(async () => {
      const { databaseConfigured, persistScanProducts } = await import("@/lib/database");
      if (
        !databaseConfigured() ||
        !discoveryState.runId ||
        !discoveryState.startedAt ||
        discoveryState.products.length === 0
      ) {
        return;
      }

      await persistScanProducts({
        runId: discoveryState.runId,
        shopId: "aboutyou-cz",
        market: "CZ",
        startedAt: discoveryState.startedAt,
        products: discoveryState.products,
      });
    })
    .catch((error) => {
      console.error("Discovery persistence failed", error);
    });

  return NextResponse.json({ ok: true }, { status: 202 });
}
