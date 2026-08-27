import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { BrowserContext, Page, Response } from "playwright";
import { aboutYouCzMen } from "@/adapters/aboutyou-cz";
import {
  discoveryState,
  type EndpointCandidate,
  type ScannedProduct,
} from "@/lib/discovery-state";

const TOTAL_STEPS = 45;
const SCROLL_DELAY_MS = 900;
const MAX_JSON_BYTES = 4_000_000;
const ENRICH_LIMIT = 24;
const ENRICH_DELAY_MS = 450;

const CLOTHING_PATTERN =
  /(tričko|košile|svetr|mikina|kalhoty|džíny|bunda|kabát|sako|blejzr|kraťasy|šortky|polo|rolák)/i;

function candidateScore(url: string, body: string) {
  let score = 0;
  if (/graphql|api|scayle/i.test(url)) score += 4;
  if (/product|listing|search|catalog|category/i.test(url)) score += 4;
  if (/page|offset|cursor|limit|perpage|pagination/i.test(url)) score += 3;
  if (/variant|stock|availability|size/i.test(body)) score += 3;
  if (/price|currency|sale|lowest/i.test(body)) score += 3;
  if (/product/i.test(body)) score += 2;
  return score;
}

function parseCzk(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function verdictFromRatio(ratio: number | null): ScannedProduct["verdict"] {
  if (ratio === null) return "NO_HISTORY";
  if (ratio <= 1) return "NEW_LOW";
  if (ratio <= 1.05) return "TOP";
  if (ratio <= 1.15) return "GOOD";
  if (ratio <= 1.3) return "OK";
  return "EXPENSIVE";
}

function parseProduct(url: string, rawText: string): ScannedProduct | null {
  const text = rawText.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const priceMatches = [...text.matchAll(/([0-9][0-9\s.]*)\s*Kč/g)];
  const currentPriceCzk = parseCzk(priceMatches[0]?.[1]);
  if (!currentPriceCzk) return null;

  const originalPriceCzk = parseCzk(
    text.match(/Původně:\s*([0-9][0-9\s.]*)\s*Kč/i)?.[1],
  );
  const lowest30dCzk = parseCzk(
    text.match(/Poslední nejnižší cena:\s*([0-9][0-9\s.]*)\s*Kč/i)?.[1],
  );

  const ratioToLow = lowest30dCzk ? currentPriceCzk / lowest30dCzk : null;
  const discountPct = originalPriceCzk
    ? Math.max(0, 1 - currentPriceCzk / originalPriceCzk)
    : null;
  const dealScore =
    ratioToLow === null
      ? null
      : Math.max(0, Math.min(100, 100 - (ratioToLow - 1) * 80));

  return {
    id: url,
    url,
    text,
    currentPriceCzk,
    originalPriceCzk,
    lowest30dCzk,
    ratioToLow,
    discountPct,
    dealScore,
    verdict: verdictFromRatio(ratioToLow),
    enriched: false,
    material: null,
    fit: null,
    color: null,
    itemNumber: null,
    materialScore: null,
    buyScore: dealScore,
    qualitySignals: [],
  };
}

function refreshProducts(productLinks: Map<string, string>) {
  const existing = new Map(discoveryState.products.map((product) => [product.url, product]));

  discoveryState.products = [...productLinks.entries()]
    .map(([url, text]) => {
      const parsed = parseProduct(url, text);
      const previous = existing.get(url);
      if (!parsed || !previous?.enriched) return parsed;
      return {
        ...parsed,
        enriched: previous.enriched,
        material: previous.material,
        fit: previous.fit,
        color: previous.color,
        itemNumber: previous.itemNumber,
        materialScore: previous.materialScore,
        buyScore: previous.buyScore,
        qualitySignals: previous.qualitySignals,
      };
    })
    .filter((product): product is ScannedProduct => product !== null)
    .sort((a, b) => {
      const aScore = a.buyScore ?? a.dealScore ?? -1;
      const bScore = b.buyScore ?? b.dealScore ?? -1;
      return bScore - aScore || a.currentPriceCzk - b.currentPriceCzk;
    })
    .slice(0, 2_000);
}

function lineField(bodyText: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = bodyText.match(new RegExp(`${escaped}:\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() || null;
}

function materialHeuristic(material: string | null) {
  if (!material) return { score: null, signals: [] as string[] };

  const value = material.toLocaleLowerCase("cs-CZ");
  let score = 55;
  const signals: string[] = [];

  const reward = (pattern: RegExp, points: number, signal: string) => {
    if (pattern.test(value)) {
      score += points;
      signals.push(signal);
    }
  };

  reward(/kašmír|cashmere/, 30, "kašmír");
  reward(/merino/, 27, "merino");
  reward(/vlna|wool/, 22, "vlna");
  reward(/len|linen/, 22, "len");
  reward(/lyocell|tencel/, 15, "lyocell/Tencel");
  reward(/modal/, 12, "modal");
  reward(/kůže|leather/, 18, "kůže");
  reward(/100\s*%\s*bavlna|100\s*%\s*cotton/, 20, "100% bavlna");

  if (/100\s*%\s*polyester/.test(value)) {
    score -= 25;
    signals.push("100% polyester");
  } else if (/polyester/.test(value)) {
    score -= 8;
    signals.push("obsahuje polyester");
  }

  if (/akryl|acrylic/.test(value)) {
    score -= 12;
    signals.push("obsahuje akryl");
  }

  return { score: Math.max(0, Math.min(100, score)), signals };
}

function buyScore(dealScore: number | null, materialScore: number | null) {
  if (dealScore === null && materialScore === null) return null;
  if (dealScore === null) return materialScore;
  if (materialScore === null) return dealScore;
  return Math.round(dealScore * 0.68 + materialScore * 0.32);
}

async function enrichShortlist(context: BrowserContext) {
  const shortlist = discoveryState.products
    .filter(
      (product) =>
        CLOTHING_PATTERN.test(product.text) &&
        (product.dealScore ?? 0) >= 65 &&
        !product.enriched,
    )
    .slice(0, ENRICH_LIMIT);

  if (shortlist.length === 0) return;

  discoveryState.phase = "enriching-materials";
  discoveryState.enrichedProducts = 0;

  const detailPage: Page = await context.newPage();

  try {
    for (const product of shortlist) {
      try {
        await detailPage.goto(product.url, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        await detailPage.waitForTimeout(ENRICH_DELAY_MS);

        const bodyText = await detailPage.locator("body").innerText();
        const material = lineField(bodyText, "Materiál");
        const fit = lineField(bodyText, "Střih");
        const color = lineField(bodyText, "Barva");
        const itemNumber =
          bodyText.match(/Položka č\.\s*([A-Za-z0-9_-]+)/i)?.[1]?.trim() || null;
        const materialResult = materialHeuristic(material);

        product.enriched = true;
        product.material = material;
        product.fit = fit;
        product.color = color;
        product.itemNumber = itemNumber;
        product.materialScore = materialResult.score;
        product.qualitySignals = materialResult.signals;
        product.buyScore = buyScore(product.dealScore, product.materialScore);
        discoveryState.enrichedProducts += 1;
      } catch {
        product.enriched = true;
      }

      await detailPage.waitForTimeout(ENRICH_DELAY_MS);
    }
  } finally {
    await detailPage.close().catch(() => undefined);
  }

  discoveryState.products.sort((a, b) => {
    const aScore = a.buyScore ?? a.dealScore ?? -1;
    const bScore = b.buyScore ?? b.dealScore ?? -1;
    return bScore - aScore || a.currentPriceCzk - b.currentPriceCzk;
  });
}

async function inspectResponse(response: Response, captureDir: string) {
  const contentType = (response.headers()["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("json")) return;

  discoveryState.jsonResponses += 1;
  const url = response.url();
  if (!aboutYouCzMen.discovery.candidateUrlPattern.test(url)) return;

  try {
    const bytes = await response.body();
    if (!bytes.byteLength || bytes.byteLength > MAX_JSON_BYTES) return;

    const body = bytes.toString("utf8");
    const score = candidateScore(url, body);
    if (score < 5) return;

    const index = discoveryState.candidateResponses + 1;
    const sampleFile = path.join("responses", `${String(index).padStart(4, "0")}.json`);
    await fs.writeFile(path.join(captureDir, sampleFile), bytes);

    const candidate: EndpointCandidate = {
      id: `${discoveryState.runId}-${index}`,
      capturedAt: new Date().toISOString(),
      method: response.request().method(),
      url,
      status: response.status(),
      contentType,
      bytes: bytes.byteLength,
      score,
      sampleFile,
    };

    discoveryState.candidateResponses = index;
    discoveryState.candidates.push(candidate);
    discoveryState.candidates.sort((a, b) => b.score - a.score || b.bytes - a.bytes);
    discoveryState.candidates = discoveryState.candidates.slice(0, 100);
  } catch {
    // Some opaque or streamed responses cannot be read. They are not useful candidates.
  }
}

export async function runAboutYouDiscovery() {
  if (discoveryState.running) return;

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const captureDir = path.resolve("data", "runs", runId);
  await fs.mkdir(path.join(captureDir, "responses"), { recursive: true });

  Object.assign(discoveryState, {
    running: true,
    runId,
    phase: "launching-browser",
    step: 0,
    totalSteps: TOTAL_STEPS,
    productLinks: 0,
    jsonResponses: 0,
    candidateResponses: 0,
    enrichedProducts: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    candidates: [],
    products: [],
  });

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    browser = await chromium.launch({
      headless: process.env.PLAYWRIGHT_HEADLESS === "1",
    });

    const context = await browser.newContext({
      locale: aboutYouCzMen.discovery.locale,
      timezoneId: aboutYouCzMen.discovery.timezoneId,
      extraHTTPHeaders: { "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.7" },
    });

    const page = await context.newPage();
    page.on("response", (response) => void inspectResponse(response, captureDir));

    discoveryState.phase = "opening-aboutyou-cz";
    await page.goto(aboutYouCzMen.discovery.startUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    for (const name of [/přijmout/i, /souhlasím/i, /accept/i]) {
      const button = page.getByRole("button", { name }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click().catch(() => undefined);
        break;
      }
    }

    const productLinks = new Map<string, string>();
    let unchangedSteps = 0;
    let previousCount = 0;

    discoveryState.phase = "discovering-network";

    for (let step = 1; step <= TOTAL_STEPS; step += 1) {
      discoveryState.step = step;

      const links = await page
        .locator(aboutYouCzMen.discovery.productLinkSelector)
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const anchor = node as HTMLAnchorElement;
            return {
              url: anchor.href,
              text: (anchor.textContent ?? "").replace(/\s+/g, " ").trim(),
            };
          }),
        );

      for (const link of links) {
        if (link.url) productLinks.set(link.url, link.text);
      }

      discoveryState.productLinks = productLinks.size;
      if (step === 1 || step % 3 === 0) refreshProducts(productLinks);

      unchangedSteps = productLinks.size === previousCount ? unchangedSteps + 1 : 0;
      previousCount = productLinks.size;

      await page.mouse.wheel(0, 5200);
      await page.waitForTimeout(SCROLL_DELAY_MS);

      if (unchangedSteps >= 10 && step >= 15) break;
    }

    discoveryState.phase = "preparing-shortlist";
    await page.waitForTimeout(1_000);
    refreshProducts(productLinks);
    await enrichShortlist(context);

    discoveryState.phase = "saving-capture";

    await fs.writeFile(
      path.join(captureDir, "product-links.json"),
      JSON.stringify(
        [...productLinks.entries()].map(([url, text]) => ({ url, text })),
        null,
        2,
      ),
    );

    await fs.writeFile(
      path.join(captureDir, "products.json"),
      JSON.stringify(discoveryState.products, null, 2),
    );

    await fs.writeFile(
      path.join(captureDir, "candidates.json"),
      JSON.stringify(discoveryState.candidates, null, 2),
    );

    await fs.writeFile(
      path.join(captureDir, "run.json"),
      JSON.stringify(
        {
          runId,
          adapter: aboutYouCzMen.id,
          market: aboutYouCzMen.market,
          startUrl: aboutYouCzMen.discovery.startUrl,
          productLinks: discoveryState.productLinks,
          parsedProducts: discoveryState.products.length,
          enrichedProducts: discoveryState.enrichedProducts,
          jsonResponses: discoveryState.jsonResponses,
          candidateResponses: discoveryState.candidateResponses,
          finishedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    discoveryState.phase = "done";
  } catch (error) {
    discoveryState.phase = "failed";
    discoveryState.error = error instanceof Error ? error.message : String(error);
  } finally {
    discoveryState.running = false;
    discoveryState.finishedAt = new Date().toISOString();
    await browser?.close().catch(() => undefined);
  }
}
