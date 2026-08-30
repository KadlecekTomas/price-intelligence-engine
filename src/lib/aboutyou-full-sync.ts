import { chromium, type Page } from "playwright";
import { parseAboutYouCard } from "@/domain/aboutyou-card";
import type { ScannedProduct } from "@/lib/discovery-state";

const DEFAULT_START_URL = "https://www.aboutyou.cz/c/muzi-20202";
const PAGE_REQUEST = /CategoryStreamService\/GetProductStreamPageV2/i;

export type AboutYouFullSyncProgress = {
  step: number;
  uniqueProducts: number;
  parsedProducts: number;
  stagnantSteps: number;
  pageRequestsObserved: number;
  elapsedMs: number;
};

export type AboutYouFullSyncOptions = {
  startUrl?: string;
  targetProducts?: number;
  maxSteps?: number;
  scrollDelayMs?: number;
  stagnantStepLimit?: number;
  checkpointEvery?: number;
  headless?: boolean;
  onCheckpoint?: (products: ScannedProduct[], progress: AboutYouFullSyncProgress) => Promise<void> | void;
  onProgress?: (progress: AboutYouFullSyncProgress) => Promise<void> | void;
};

export type AboutYouFullSyncResult = {
  startUrl: string;
  products: ScannedProduct[];
  steps: number;
  pageRequestsObserved: number;
  elapsedMs: number;
  stoppedBecause: "target" | "stagnant" | "max-steps";
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.round(value!), max));
}

function safeStartUrl(value: string | undefined) {
  const raw = value || DEFAULT_START_URL;
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "www.aboutyou.cz") {
    throw new Error("Full sync start URL must be a public https://www.aboutyou.cz URL");
  }
  if (!url.pathname.startsWith("/c/muzi")) {
    throw new Error("Full sync currently supports ABOUT YOU CZ men's category URLs only");
  }
  return url.toString();
}

function canonicalProductUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname !== "www.aboutyou.cz" || !url.pathname.includes("/p/")) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function acceptConsent(page: Page) {
  for (const name of [/přijmout/i, /souhlasím/i, /accept/i]) {
    const button = page.getByRole("button", { name }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => undefined);
      return;
    }
  }
}

async function readVisibleProductCards(page: Page) {
  return page.locator('a[href*="/p/"]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const anchor = node as HTMLAnchorElement;
      const anchorText = (anchor.textContent ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      let firstPriceText: string | null = /Kč/.test(anchorText) ? anchorText : null;
      let preferredText: string | null = null;
      let current: HTMLElement | null = anchor;

      for (let depth = 0; depth < 8 && current; depth += 1) {
        const candidate = (current.innerText || current.textContent || "")
          .replace(/\u00a0/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const productLinkCount = current.querySelectorAll('a[href*="/p/"]').length;
        if (
          candidate.length > 0 &&
          candidate.length <= 3_500 &&
          productLinkCount <= 4 &&
          /Kč/.test(candidate)
        ) {
          firstPriceText ??= candidate;
          if (/Poslední nejnižší cena|Původně:/i.test(candidate)) {
            preferredText = candidate;
            break;
          }
        }
        current = current.parentElement;
      }

      return {
        url: anchor.href,
        text: preferredText ?? firstPriceText ?? anchorText,
      };
    }),
  );
}

function richerProduct(existing: ScannedProduct | undefined, candidate: ScannedProduct) {
  if (!existing) return candidate;
  const existingSignals = Number(existing.originalPriceCzk !== null) + Number(existing.lowest30dCzk !== null);
  const candidateSignals = Number(candidate.originalPriceCzk !== null) + Number(candidate.lowest30dCzk !== null);
  if (candidateSignals !== existingSignals) return candidateSignals > existingSignals ? candidate : existing;
  return candidate.text.length > existing.text.length ? candidate : existing;
}

export async function collectAboutYouFullCatalog(
  options: AboutYouFullSyncOptions = {},
): Promise<AboutYouFullSyncResult> {
  const startUrl = safeStartUrl(options.startUrl);
  const targetProducts = clampInt(options.targetProducts, 120_000, 100, 200_000);
  const maxSteps = clampInt(options.maxSteps, 5_000, 10, 10_000);
  const scrollDelayMs = clampInt(options.scrollDelayMs, 650, 250, 5_000);
  const stagnantStepLimit = clampInt(options.stagnantStepLimit, 24, 5, 100);
  const checkpointEvery = clampInt(options.checkpointEvery, 750, 100, 5_000);
  const started = Date.now();
  const products = new Map<string, ScannedProduct>();
  const dirty = new Map<string, ScannedProduct>();
  let pageRequestsObserved = 0;
  let stagnantSteps = 0;
  let previousCount = 0;
  let completedSteps = 0;
  let stoppedBecause: AboutYouFullSyncResult["stoppedBecause"] = "max-steps";

  const browser = await chromium.launch({ headless: options.headless ?? true });
  try {
    const context = await browser.newContext({
      locale: "cs-CZ",
      timezoneId: "Europe/Prague",
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.6" },
    });
    const page = await context.newPage();
    page.on("request", (request) => {
      if (PAGE_REQUEST.test(request.url())) pageRequestsObserved += 1;
    });

    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await acceptConsent(page);
    await page.waitForTimeout(900);

    const progress = (step: number): AboutYouFullSyncProgress => ({
      step,
      uniqueProducts: products.size,
      parsedProducts: products.size,
      stagnantSteps,
      pageRequestsObserved,
      elapsedMs: Date.now() - started,
    });

    const flushCheckpoint = async (step: number, force = false) => {
      if (!options.onCheckpoint || dirty.size === 0) return;
      if (!force && dirty.size < checkpointEvery) return;
      const batch = [...dirty.values()];
      dirty.clear();
      await options.onCheckpoint(batch, progress(step));
    };

    for (let step = 1; step <= maxSteps; step += 1) {
      completedSteps = step;
      const cards = await readVisibleProductCards(page);
      for (const card of cards) {
        const url = canonicalProductUrl(card.url);
        if (!url) continue;
        const parsed = parseAboutYouCard(url, card.text);
        if (!parsed) continue;
        parsed.qualitySignals.push("ABOUT YOU full-sync: public product stream");
        const selected = richerProduct(products.get(url), parsed);
        products.set(url, selected);
        dirty.set(url, selected);
      }

      stagnantSteps = products.size === previousCount ? stagnantSteps + 1 : 0;
      previousCount = products.size;

      await flushCheckpoint(step);
      if (step === 1 || step % 10 === 0) await options.onProgress?.(progress(step));

      if (products.size >= targetProducts) {
        stoppedBecause = "target";
        break;
      }
      if (stagnantSteps >= stagnantStepLimit && step >= 12) {
        stoppedBecause = "stagnant";
        break;
      }

      const nextPageSignal = page
        .waitForResponse((response) => PAGE_REQUEST.test(response.url()), { timeout: Math.max(1_500, scrollDelayMs * 4) })
        .catch(() => null);
      await page.mouse.wheel(0, 5_500);
      await Promise.race([
        nextPageSignal,
        page.waitForTimeout(scrollDelayMs),
      ]);
      await page.waitForTimeout(Math.min(300, Math.max(80, Math.round(scrollDelayMs / 3))));
    }

    await flushCheckpoint(completedSteps, true);
    await options.onProgress?.(progress(completedSteps));
  } finally {
    await browser.close();
  }

  return {
    startUrl,
    products: [...products.values()],
    steps: completedSteps,
    pageRequestsObserved,
    elapsedMs: Date.now() - started,
    stoppedBecause,
  };
}
