import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { Response } from "playwright";
import { aboutYouCzMen } from "@/adapters/aboutyou-cz";
import { discoveryState, type EndpointCandidate } from "@/lib/discovery-state";

const TOTAL_STEPS = 45;
const SCROLL_DELAY_MS = 900;
const MAX_JSON_BYTES = 4_000_000;

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
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    candidates: [],
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
      unchangedSteps = productLinks.size === previousCount ? unchangedSteps + 1 : 0;
      previousCount = productLinks.size;

      await page.mouse.wheel(0, 5200);
      await page.waitForTimeout(SCROLL_DELAY_MS);

      if (unchangedSteps >= 10 && step >= 15) break;
    }

    discoveryState.phase = "saving-capture";
    await page.waitForTimeout(1_200);

    await fs.writeFile(
      path.join(captureDir, "product-links.json"),
      JSON.stringify(
        [...productLinks.entries()].map(([url, text]) => ({ url, text })),
        null,
        2,
      ),
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
