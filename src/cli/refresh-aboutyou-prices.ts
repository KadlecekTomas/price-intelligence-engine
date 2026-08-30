import { collectAboutYouFullCatalog } from "@/lib/aboutyou-full-sync";
import { assessCatalogCoverage } from "@/lib/catalog-coverage";
import {
  finalizeCatalogRun,
  finishPriceRefreshRun,
  markRunKind,
  readActiveCatalogPartitions,
  upsertPartitionState,
} from "@/lib/catalog-maintenance-database";
import {
  beginFullSyncRun,
  persistFullSyncProducts,
  type FullSyncRun,
} from "@/lib/full-sync-database";

function arg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function intArg(name: string, fallback: number) {
  const parsed = Number(arg(name));
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function numberArg(name: string, fallback: number) {
  const parsed = Number(arg(name));
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
  const maxSteps = intArg("max-steps", 300);
  const delay = intArg("delay", 400);
  const minimumPartitionCoverage = numberArg("min-partition-coverage", 0.98);
  const partitions = await readActiveCatalogPartitions("aboutyou-cz", "CZ");
  if (partitions.length === 0) {
    console.log("Price refresh skipped — no verified active catalog partitions exist yet.");
    console.log("A successful partitioned full catalog sync must publish first.");
    return;
  }

  const runId = `aboutyou-prices-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const run: FullSyncRun = {
    runId,
    shopId: "aboutyou-cz",
    market: "CZ",
    startedAt: new Date().toISOString(),
  };

  console.log("\nPrice Intelligence — ABOUT YOU price refresh");
  console.log(`Run: ${runId}`);
  console.log(`Verified partitions: ${partitions.length}`);
  console.log(`Local refresh coverage gate: ${(minimumPartitionCoverage * 100).toFixed(1)} %\n`);

  await beginFullSyncRun(run);
  await markRunKind(runId, "price_refresh");

  const observedIds = new Set<string>();
  let completePartitions = 0;
  let partialPartitions = 0;
  let failedPartitions = 0;
  let applied = false;

  try {
    for (let index = 0; index < partitions.length; index += 1) {
      const partition = partitions[index];
      console.log(`[${index + 1}/${partitions.length}] ${partition.key}`);
      await upsertPartitionState({ runId, partition, status: "running" });

      try {
        const result = await collectAboutYouFullCatalog({
          startUrl: partition.url,
          targetProducts: 200_000,
          maxSteps,
          scrollDelayMs: delay,
          minimumCoverage: minimumPartitionCoverage,
          checkpointEvery: 500,
          headless: true,
          onCheckpoint: async (products) => {
            for (const product of products) observedIds.add(product.id);
            await persistFullSyncProducts(run, products, 500);
          },
        });
        for (const product of result.products) observedIds.add(product.id);

        const assessment = assessCatalogCoverage({
          observedProducts: result.products.length,
          reportedProducts: result.reportedProducts,
          stoppedBecause: result.stoppedBecause,
          minimumCoverage: minimumPartitionCoverage,
        });
        const status = assessment.publishable ? "complete" as const : "truncated" as const;
        if (status === "complete") completePartitions += 1;
        else partialPartitions += 1;

        await upsertPartitionState({
          runId,
          partition,
          status,
          expectedCount: result.reportedProducts,
          discoveredCount: result.products.length,
          error: assessment.publishable ? null : assessment.reason,
          metadata: {
            coverage: result.coverage,
            stopReason: result.stoppedBecause,
            pageRequestsObserved: result.pageRequestsObserved,
          },
        });
      } catch (error) {
        failedPartitions += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  failed: ${message}`);
        await upsertPartitionState({ runId, partition, status: "failed", error: message }).catch(() => undefined);
      }
    }

    if (observedIds.size === 0) throw new Error("Price refresh collected no products from verified partitions");

    const result = await finishPriceRefreshRun(runId);
    applied = true;
    const allComplete = completePartitions === partitions.length && partialPartitions === 0 && failedPartitions === 0;
    await finalizeCatalogRun({
      runId,
      status: allComplete ? "complete" : "incomplete",
      reportedProductCount: null,
      observedProductCount: result.matched,
      coverage: null,
      stopReason: allComplete ? "all-price-partitions-complete" : "partial-price-refresh",
      metadata: {
        activeCatalogRunId: result.activeRunId,
        changedProducts: result.changed,
        observedProducts: observedIds.size,
        completePartitions,
        partialPartitions,
        failedPartitions,
        totalPartitions: partitions.length,
      },
    });

    console.log("\nPRICE REFRESH HOTOV");
    console.log(`Observed unique: ${observedIds.size.toLocaleString("cs-CZ")}`);
    console.log(`Matched active products: ${result.matched.toLocaleString("cs-CZ")}`);
    console.log(`Price changes: ${result.changed.toLocaleString("cs-CZ")}`);
    console.log(`Partitions: ${completePartitions}/${partitions.length} complete · ${partialPartitions} partial · ${failedPartitions} failed`);
    console.log(`Run status: ${allComplete ? "complete" : "incomplete (safe partial prices applied)"}\n`);
  } catch (error) {
    if (!applied) {
      await finalizeCatalogRun({
        runId,
        status: "failed",
        reportedProductCount: null,
        observedProductCount: observedIds.size,
        coverage: null,
        stopReason: error instanceof Error ? error.message : String(error),
        discardStaging: true,
        metadata: { completePartitions, partialPartitions, failedPartitions, totalPartitions: partitions.length },
      }).catch(() => undefined);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error("Price refresh failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
