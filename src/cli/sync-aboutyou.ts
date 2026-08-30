import {
  collectAboutYouFullCatalog,
  type AboutYouFullSyncProgress,
} from "@/lib/aboutyou-full-sync";
import { assessCatalogCoverage } from "@/lib/catalog-coverage";
import {
  abandonFullSyncRun,
  beginFullSyncRun,
  finishFullSyncRun,
  persistFullSyncProducts,
  type FullSyncRun,
} from "@/lib/full-sync-database";

function arg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function intArg(name: string, fallback: number) {
  const value = Number(arg(name));
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function numberArg(name: string, fallback: number) {
  const value = Number(arg(name));
  return Number.isFinite(value) ? value : fallback;
}

function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function formatCoverage(value: number | null) {
  return value === null ? "neznámé" : `${(value * 100).toFixed(2)} %`;
}

function printProgress(progress: AboutYouFullSyncProgress) {
  console.log(
    `[ABOUT YOU] step ${progress.step} · ${progress.uniqueProducts.toLocaleString("cs-CZ")} produktů` +
    ` / ${progress.reportedProducts?.toLocaleString("cs-CZ") ?? "?"}` +
    ` · coverage ${formatCoverage(progress.coverage)}` +
    ` · ${progress.pageRequestsObserved} page requestů · ${formatDuration(progress.elapsedMs)}`,
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const runId = `aboutyou-full-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const run: FullSyncRun = {
    runId,
    shopId: "aboutyou-cz",
    market: "CZ",
    startedAt: new Date().toISOString(),
  };

  const startUrl = arg("url") ?? "https://www.aboutyou.cz/c/muzi-20202";
  const targetProducts = intArg("target", 120_000);
  const maxSteps = intArg("max-steps", 5_000);
  const scrollDelayMs = intArg("delay", 650);
  const checkpointEvery = intArg("checkpoint", 750);
  const minimumCoverage = numberArg("min-coverage", 0.995);

  console.log("\nPrice Intelligence — ABOUT YOU full catalog sync");
  console.log(`Run: ${runId}`);
  console.log(`URL: ${startUrl}`);
  console.log(`Cíl: ${targetProducts.toLocaleString("cs-CZ")} produktů · max ${maxSteps} kroků · delay ${scrollDelayMs} ms`);
  console.log(`Publication gate: ${(minimumCoverage * 100).toFixed(2)} % reported catalog coverage`);
  console.log(dryRun ? "Režim: DRY RUN (bez DB zápisu)\n" : "Režim: checkpointed PostgreSQL sync\n");

  if (!dryRun) await beginFullSyncRun(run);

  try {
    const result = await collectAboutYouFullCatalog({
      startUrl,
      targetProducts,
      maxSteps,
      scrollDelayMs,
      checkpointEvery,
      minimumCoverage,
      headless: true,
      onProgress: printProgress,
      onCheckpoint: dryRun
        ? undefined
        : async (products, progress) => {
            const persisted = await persistFullSyncProducts(run, products, 500);
            console.log(
              `[checkpoint] ${persisted.toLocaleString("cs-CZ")} řádků · celkem objeveno ${progress.uniqueProducts.toLocaleString("cs-CZ")}`,
            );
          },
    });

    const assessment = assessCatalogCoverage({
      observedProducts: result.products.length,
      reportedProducts: result.reportedProducts,
      stoppedBecause: result.stoppedBecause,
      minimumCoverage,
    });

    if (!dryRun && !assessment.publishable) {
      throw new Error(`Refusing incomplete catalog publication: ${assessment.reason}`);
    }

    if (!dryRun) await finishFullSyncRun(runId, result.products.length);

    console.log("\nFULL SYNC HOTOV");
    console.log(`Produkty: ${result.products.length.toLocaleString("cs-CZ")}`);
    console.log(`Reported: ${result.reportedProducts?.toLocaleString("cs-CZ") ?? "neznámé"}`);
    console.log(`Coverage: ${formatCoverage(result.coverage)}`);
    console.log(`Publishable: ${assessment.publishable ? "ANO" : "NE"} (${assessment.reason})`);
    console.log(`Kroky: ${result.steps}`);
    console.log(`GetProductStreamPageV2 requesty: ${result.pageRequestsObserved}`);
    console.log(`Stop: ${result.stoppedBecause}`);
    console.log(`Čas: ${formatDuration(result.elapsedMs)}\n`);
  } catch (error) {
    if (!dryRun) await abandonFullSyncRun(runId).catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  console.error("Full catalog sync selhal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
