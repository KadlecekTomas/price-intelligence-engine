import fs from "node:fs/promises";
import path from "node:path";
import { runAboutYouDiscovery } from "@/lib/discovery-runner";
import { discoveryState, type ScannedProduct } from "@/lib/discovery-state";
import {
  databaseConfigured,
  persistScanProducts,
  readLatestProducts,
} from "@/lib/database";
import {
  filterAndRankProducts,
  parseShoppingFilters,
  type ShoppingFilters,
} from "@/domain/shopping-filters";
import {
  analyzeJsonCandidate,
  rankEndpointAnalyses,
} from "@/domain/endpoint-analysis";

function money(value: number | null | undefined) {
  return value == null ? "—" : `${value.toLocaleString("cs-CZ")} Kč`;
}

function pct(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)} %`;
}

function filterSummary(filters: ShoppingFilters) {
  const active = [
    filters.maxPriceCzk !== null ? `max ${money(filters.maxPriceCzk)}` : null,
    filters.minBuyScore !== null ? `buy ≥ ${filters.minBuyScore}` : null,
    filters.minHistoryScore !== null ? `historie ≥ ${filters.minHistoryScore}` : null,
    filters.contains ? `obsahuje „${filters.contains}“` : null,
    filters.size ? `velikost ${filters.size}` : null,
    `limit ${filters.limit}`,
  ].filter(Boolean);

  return active.join(" · ");
}

function reportMarkdown(
  allProducts: ScannedProduct[],
  filteredProducts: ScannedProduct[],
  filters: ShoppingFilters,
) {
  const rows = filteredProducts
    .map((product, index) => {
      const score = product.buyScore ?? product.dealScore ?? "—";
      const historyScore = product.historyScore == null ? "—" : Math.round(product.historyScore);
      const material = product.material?.replaceAll("|", "/") ?? "—";
      const text = product.text.replaceAll("|", "/").slice(0, 110);
      return `| ${index + 1} | ${score} | ${historyScore} | ${money(product.currentPriceCzk)} | ${money(product.lowest30dCzk)} | ${money(product.observedMinCzk)} | ${product.observationCount ?? "—"} | ${material} | [${text}](${product.url}) |`;
    })
    .join("\n");

  return `# Dnešní shopping shortlist\n\n` +
    `Run: \`${discoveryState.runId ?? "unknown"}\`  \n` +
    `Filtry: **${filterSummary(filters)}**  \n` +
    `Nalezeno produktových odkazů: **${discoveryState.productLinks}**  \n` +
    `Vyhodnoceno produktů: **${allProducts.length}**  \n` +
    `Po filtrech: **${filteredProducts.length}**  \n` +
    `Materiálově ověřeno: **${discoveryState.enrichedProducts}**\n\n` +
    `> Buy score kombinuje cenový a materiálový signál. „30d min“ je údaj e-shopu; „Naše min“ vzniká výhradně z uložených price snapshotů a po více scanech je pro nás důležitější. Velikostní filtr je zatím best-effort nad textem produktové karty, dokud nemáme variant-level endpoint.\n\n` +
    `| # | Buy | Historie | Cena | 30d min | Naše min | Obs. | Materiál | Produkt |\n` +
    `|---:|---:|---:|---:|---:|---:|---:|---|---|\n${rows || "| — | — | — | — | — | — | — | — | Žádný produkt neprošel filtry |"}\n`;
}

async function analyzeCapturedEndpoints(runDir: string) {
  const analyses = [];

  for (const candidate of discoveryState.candidates) {
    try {
      const samplePath = path.join(runDir, candidate.sampleFile);
      const raw = await fs.readFile(samplePath, "utf8");
      const payload: unknown = JSON.parse(raw);
      analyses.push(analyzeJsonCandidate(candidate, payload));
    } catch {
      // A malformed or already-removed response sample is not a useful candidate.
    }
  }

  const ranked = rankEndpointAnalyses(analyses);
  await fs.writeFile(
    path.join(runDir, "endpoint-analysis.json"),
    JSON.stringify(ranked, null, 2),
    "utf8",
  );

  return ranked;
}

function printHelp() {
  console.log(`\nPrice Intelligence Engine — shopping filters\n\n` +
    `npm run scan -- [filtry]\n\n` +
    `  --max-price=2000      maximální cena v Kč\n` +
    `  --min-buy=70          minimální Buy score\n` +
    `  --min-history=80      minimální vlastní history score (vyžaduje více DB snapshotů)\n` +
    `  --contains=tričko     textový filtr produktu/materiálu\n` +
    `  --size=L              best-effort velikostní filtr z textu produktové karty\n` +
    `  --limit=20            počet výsledků, 1–100\n\n` +
    `Příklad:\n` +
    `  npm run scan -- --max-price=2000 --contains=tričko --min-buy=70 --limit=15\n`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const filters = parseShoppingFilters(args);

  console.log("\nPrice Intelligence Engine — ABOUT YOU CZ / Muži");
  console.log(`Filtry: ${filterSummary(filters)}`);
  console.log("Spouštím lokální Chromium scan…\n");

  await runAboutYouDiscovery();

  if (discoveryState.error) {
    throw new Error(discoveryState.error);
  }

  if (!discoveryState.runId) {
    throw new Error("Scan skončil bez runId");
  }

  let reportProducts = discoveryState.products;

  if (databaseConfigured() && discoveryState.startedAt && discoveryState.products.length > 0) {
    console.log("Zapisuji scan do PostgreSQL…");
    await persistScanProducts({
      runId: discoveryState.runId,
      shopId: "aboutyou-cz",
      market: "CZ",
      startedAt: discoveryState.startedAt,
      products: discoveryState.products,
    });
    reportProducts = await readLatestProducts(500);
  } else {
    console.log("DATABASE_URL není nastavený — pokračuji čistě lokálně.");
  }

  const filtered = filterAndRankProducts(reportProducts, filters);
  const runDir = path.resolve("data", "runs", discoveryState.runId);
  const reportPath = path.join(runDir, "shopping-report.md");
  await fs.writeFile(
    reportPath,
    reportMarkdown(reportProducts, filtered, filters),
    "utf8",
  );

  const endpointAnalyses = await analyzeCapturedEndpoints(runDir);
  const bestEndpoint = endpointAnalyses[0];

  console.log(`\nTOP kandidáti po filtrech (${filtered.length}):\n`);
  console.table(
    filtered.map((product) => ({
      buy: product.buyScore ?? product.dealScore ?? "—",
      historie: product.historyScore == null ? "—" : Math.round(product.historyScore),
      cena: money(product.currentPriceCzk),
      min30d: money(product.lowest30dCzk),
      naseMin: money(product.observedMinCzk),
      obs: product.observationCount ?? "—",
      sleva: pct(product.discountPct),
      material: product.material ?? "—",
      url: product.url,
    })),
  );

  if (bestEndpoint) {
    const bestArray = bestEndpoint.productArrays[0];
    const largestTotal = bestEndpoint.numericTotals[0];
    console.log("\nNejlepší endpoint kandidát:\n");
    console.table([
      {
        bulk: bestEndpoint.likelyBulk ? "ANO" : "zatím ne",
        score: bestEndpoint.totalScore,
        pole: bestArray?.path ?? "—",
        polozekVeVzorku: bestArray?.length ?? "—",
        total: largestTotal?.value ?? "—",
        pagination: bestEndpoint.paginationKeys.slice(0, 4).join(", ") || "—",
        url: bestEndpoint.url,
      },
    ]);
  }

  console.log(`\nReport: ${reportPath}`);
  console.log(`Endpoint analýza: ${path.join(runDir, "endpoint-analysis.json")}`);
  console.log(`Vyhodnoceno: ${reportProducts.length}`);
  console.log(`Po filtrech: ${filtered.length}`);
  console.log(`Endpoint kandidáti: ${discoveryState.candidateResponses}`);
  console.log("\nHotovo.\n");
}

main().catch((error) => {
  console.error("\nScan selhal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
