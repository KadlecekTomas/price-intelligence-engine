import fs from "node:fs/promises";
import path from "node:path";
import { runAboutYouDiscovery } from "@/lib/discovery-runner";
import { discoveryState, type ScannedProduct } from "@/lib/discovery-state";
import { databaseConfigured, persistScanProducts } from "@/lib/database";

function money(value: number | null) {
  return value === null ? "—" : `${value.toLocaleString("cs-CZ")} Kč`;
}

function pct(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)} %`;
}

function shortlist(products: ScannedProduct[]) {
  return [...products]
    .filter((product) => product.currentPriceCzk > 0)
    .sort((a, b) => {
      const aScore = a.buyScore ?? a.dealScore ?? -1;
      const bScore = b.buyScore ?? b.dealScore ?? -1;
      return bScore - aScore || a.currentPriceCzk - b.currentPriceCzk;
    })
    .slice(0, 30);
}

function reportMarkdown(products: ScannedProduct[]) {
  const rows = shortlist(products)
    .map((product, index) => {
      const score = product.buyScore ?? product.dealScore ?? "—";
      const material = product.material?.replaceAll("|", "/") ?? "—";
      const text = product.text.replaceAll("|", "/").slice(0, 110);
      return `| ${index + 1} | ${score} | ${money(product.currentPriceCzk)} | ${money(product.lowest30dCzk)} | ${material} | [${text}](${product.url}) |`;
    })
    .join("\n");

  return `# Dnešní shopping shortlist\n\n` +
    `Run: \`${discoveryState.runId ?? "unknown"}\`  \n` +
    `Nalezeno produktových odkazů: **${discoveryState.productLinks}**  \n` +
    `Vyhodnoceno produktů: **${products.length}**  \n` +
    `Materiálově ověřeno: **${discoveryState.enrichedProducts}**\n\n` +
    `> Buy score kombinuje cenový signál a u oblečení i jednoduchý materiálový signál. 30denní minimum je údaj e-shopu; vlastní historické minimum začne být silnější až po více našich scanech.\n\n` +
    `| # | Buy score | Cena | 30d min | Materiál | Produkt |\n` +
    `|---:|---:|---:|---:|---|---|\n${rows}\n`;
}

async function main() {
  console.log("\nPrice Intelligence Engine — ABOUT YOU CZ / Muži");
  console.log("Spouštím lokální Chromium scan…\n");

  await runAboutYouDiscovery();

  if (discoveryState.error) {
    throw new Error(discoveryState.error);
  }

  if (!discoveryState.runId) {
    throw new Error("Scan skončil bez runId");
  }

  if (databaseConfigured() && discoveryState.startedAt && discoveryState.products.length > 0) {
    console.log("Zapisuji scan do PostgreSQL…");
    await persistScanProducts({
      runId: discoveryState.runId,
      shopId: "aboutyou-cz",
      market: "CZ",
      startedAt: discoveryState.startedAt,
      products: discoveryState.products,
    });
  } else {
    console.log("DATABASE_URL není nastavený — pokračuji čistě lokálně.");
  }

  const runDir = path.resolve("data", "runs", discoveryState.runId);
  const reportPath = path.join(runDir, "shopping-report.md");
  await fs.writeFile(reportPath, reportMarkdown(discoveryState.products), "utf8");

  const top = shortlist(discoveryState.products).slice(0, 15);
  console.log("\nTOP kandidáti:\n");
  console.table(
    top.map((product) => ({
      buy: product.buyScore ?? product.dealScore ?? "—",
      cena: money(product.currentPriceCzk),
      min30d: money(product.lowest30dCzk),
      sleva: pct(product.discountPct),
      material: product.material ?? "—",
      url: product.url,
    })),
  );

  console.log(`\nReport: ${reportPath}`);
  console.log(`Produkty: ${discoveryState.products.length}`);
  console.log(`Endpoint kandidáti: ${discoveryState.candidateResponses}`);
  console.log("\nHotovo.\n");
}

main().catch((error) => {
  console.error("\nScan selhal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
