import {
  buildAboutYouPartitionPlan,
  type AboutYouPartition,
} from "@/lib/aboutyou-partitions";
import { collectAboutYouFullCatalog } from "@/lib/aboutyou-full-sync";
import { assessCatalogCoverage, coverageRatio } from "@/lib/catalog-coverage";
import {
  finalizeCatalogRun,
  markRunKind,
  upsertPartitionState,
} from "@/lib/catalog-maintenance-database";
import {
  beginFullSyncRun,
  finishFullSyncRun,
  persistFullSyncProducts,
  type FullSyncRun,
} from "@/lib/full-sync-database";
import type { ScannedProduct } from "@/lib/discovery-state";

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

function pct(value: number | null) {
  return value === null ? "?" : `${(value * 100).toFixed(2)} %`;
}

function richerProduct(existing: ScannedProduct | undefined, candidate: ScannedProduct) {
  if (!existing) return candidate;
  const existingSignals = Number(existing.originalPriceCzk !== null) + Number(existing.lowest30dCzk !== null);
  const candidateSignals = Number(candidate.originalPriceCzk !== null) + Number(candidate.lowest30dCzk !== null);
  if (candidateSignals !== existingSignals) return candidateSignals > existingSignals ? candidate : existing;
  return candidate.text.length > existing.text.length ? candidate : existing;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const startUrl = arg("url") ?? "https://www.aboutyou.cz/c/muzi-20202";
  const splitAbove = intArg("split-above", 850);
  const maxPartitions = intArg("max-partitions", 2_000);
  const maxStepsPerPartition = intArg("max-steps", 350);
  const scrollDelayMs = intArg("delay", 450);
  const minimumCoverage = numberArg("min-coverage", 0.995);
  const runId = `aboutyou-partitioned-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const run: FullSyncRun = {
    runId,
    shopId: "aboutyou-cz",
    market: "CZ",
    startedAt: new Date().toISOString(),
  };

  console.log("\nPrice Intelligence — ABOUT YOU partitioned full catalog sync");
  console.log(`Run: ${runId}`);
  console.log(`Split above: ${splitAbove.toLocaleString("cs-CZ")} · publication coverage: ${(minimumCoverage * 100).toFixed(2)} %`);
  console.log(dryRun ? "Mode: DRY RUN\n" : "Mode: PostgreSQL atomic publication\n");

  let rootReportedCount: number | null = null;
  let finalized = false;
  if (!dryRun) {
    await beginFullSyncRun(run);
    await markRunKind(runId, "full_catalog");
  }

  try {
    console.log("Plánuji category/brand partitions…");
    const plan = await buildAboutYouPartitionPlan({
      startUrl,
      splitAbove,
      maxPartitions,
      onInspect(inspection) {
        if (new URL(inspection.url).pathname === new URL(startUrl).pathname && !new URL(inspection.url).search) {
          rootReportedCount = inspection.reportedCount;
        }
        console.log(
          `[plan] ${new URL(inspection.url).pathname}${new URL(inspection.url).search}` +
          ` · expected ${inspection.reportedCount?.toLocaleString("cs-CZ") ?? "?"}` +
          ` · children ${inspection.childCategories.length} · brands ${inspection.brandPartitions.length}`,
        );
      },
    });

    if (plan.length === 0) throw new Error("Partition planner produced no crawlable leaves");
    console.log(`\nPartition leaves: ${plan.length.toLocaleString("cs-CZ")}`);
    console.log(`Root reported catalog: ${rootReportedCount?.toLocaleString("cs-CZ") ?? "UNKNOWN"}\n`);

    const globalProducts = new Map<string, ScannedProduct>();
    let completePartitions = 0;
    let truncatedPartitions = 0;
    let failedPartitions = 0;

    for (let index = 0; index < plan.length; index += 1) {
      const partition: AboutYouPartition = plan[index];
      const label = `[${index + 1}/${plan.length}] ${partition.key}`;
      console.log(`\n${label}`);
      if (!dryRun) await upsertPartitionState({ runId, partition, status: "running" });

      try {
        const result = await collectAboutYouFullCatalog({
          startUrl: partition.url,
          targetProducts: 200_000,
          maxSteps: maxStepsPerPartition,
          scrollDelayMs,
          minimumCoverage,
          checkpointEvery: 500,
          headless: true,
          onCheckpoint: dryRun
            ? undefined
            : async (products) => {
                await persistFullSyncProducts(run, products, 500);
              },
        });

        for (const product of result.products) {
          globalProducts.set(product.id, richerProduct(globalProducts.get(product.id), product));
        }

        const local = assessCatalogCoverage({
          observedProducts: result.products.length,
          reportedProducts: result.reportedProducts,
          stoppedBecause: result.stoppedBecause,
          minimumCoverage,
        });
        const status = local.publishable ? "complete" as const : "truncated" as const;
        if (status === "complete") completePartitions += 1;
        else truncatedPartitions += 1;

        if (!dryRun) {
          await upsertPartitionState({
            runId,
            partition,
            status,
            expectedCount: result.reportedProducts,
            discoveredCount: result.products.length,
            error: local.publishable ? null : local.reason,
            metadata: {
              coverage: result.coverage,
              stopReason: result.stoppedBecause,
              pageRequestsObserved: result.pageRequestsObserved,
              steps: result.steps,
            },
          });
        }

        console.log(
          `${status === "complete" ? "✓" : "⚠"} ${result.products.length.toLocaleString("cs-CZ")}` +
          ` / ${result.reportedProducts?.toLocaleString("cs-CZ") ?? "?"}` +
          ` · ${pct(result.coverage)} · ${result.stoppedBecause}`,
        );
      } catch (error) {
        failedPartitions += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`✗ ${label}: ${message}`);
        if (!dryRun) {
          await upsertPartitionState({ runId, partition, status: "failed", error: message }).catch(() => undefined);
        }
      }
    }

    const globalCoverage = coverageRatio(globalProducts.size, rootReportedCount);
    const allComplete = completePartitions === plan.length && failedPartitions === 0 && truncatedPartitions === 0;
    const globalAssessment = assessCatalogCoverage({
      observedProducts: globalProducts.size,
      reportedProducts: rootReportedCount,
      stoppedBecause: allComplete ? "reported-total" : "stagnant",
      minimumCoverage,
    });
    const publishable = allComplete && globalAssessment.publishable;

    console.log("\nPARTITIONED CATALOG RESULT");
    console.log(`Unique products: ${globalProducts.size.toLocaleString("cs-CZ")}`);
    console.log(`Reported root: ${rootReportedCount?.toLocaleString("cs-CZ") ?? "?"}`);
    console.log(`Global coverage: ${pct(globalCoverage)}`);
    console.log(`Partitions: ${completePartitions}/${plan.length} complete · ${truncatedPartitions} truncated · ${failedPartitions} failed`);
    console.log(`Publishable: ${publishable ? "ANO" : "NE"}`);

    if (dryRun) return;

    if (!publishable) {
      await finalizeCatalogRun({
        runId,
        status: "incomplete",
        reportedProductCount: rootReportedCount,
        observedProductCount: globalProducts.size,
        coverage: globalCoverage,
        stopReason: globalAssessment.reason,
        discardStaging: true,
        metadata: { completePartitions, truncatedPartitions, failedPartitions, totalPartitions: plan.length },
      });
      finalized = true;
      throw new Error(`Catalog publication blocked: ${globalAssessment.reason}`);
    }

    await finishFullSyncRun(runId, globalProducts.size);
    await finalizeCatalogRun({
      runId,
      status: "complete",
      reportedProductCount: rootReportedCount,
      observedProductCount: globalProducts.size,
      coverage: globalCoverage,
      stopReason: "all-partitions-complete",
      metadata: { completePartitions, truncatedPartitions, failedPartitions, totalPartitions: plan.length },
    });
    finalized = true;
    console.log("\n✓ New catalog published atomically.\n");
  } catch (error) {
    if (!dryRun && !finalized) {
      await finalizeCatalogRun({
        runId,
        status: "failed",
        reportedProductCount: rootReportedCount,
        observedProductCount: 0,
        coverage: null,
        stopReason: error instanceof Error ? error.message : String(error),
        discardStaging: true,
      }).catch(() => undefined);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error("Partitioned full catalog sync failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
