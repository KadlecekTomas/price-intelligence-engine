import { chromium } from "playwright";

const TARGET = "https://www.aboutyou.cz/c/muzi-20202";
const STREAM = /CategoryStreamService\/(GetProductStreamV2|GetProductStreamPageV2|GetAdditionalProductStreamV2|GetAdditionalProductStream)/i;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "cs-CZ",
  timezoneId: "Europe/Prague",
  viewport: { width: 1440, height: 1000 },
  extraHTTPHeaders: { "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.6" },
});
const page = await context.newPage();
const requests = [];

page.on("request", (request) => {
  if (!STREAM.test(request.url())) return;
  requests.push({
    endpoint: request.url().split("/").at(-1),
    method: request.method(),
    bodyBytes: request.postDataBuffer()?.length ?? 0,
  });
});

try {
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 60_000 });
  for (const name of [/přijmout/i, /souhlasím/i, /accept/i]) {
    const button = page.getByRole("button", { name }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => undefined);
      break;
    }
  }
  await page.waitForTimeout(1_000);

  const samples = [];
  let best = 0;
  let stagnant = 0;
  for (let step = 1; step <= 45; step += 1) {
    const count = await page.locator('a[href*="/p/"]').evaluateAll(
      (nodes) => new Set(nodes.map((node) => node.href.split("?")[0])).size,
    );
    if (count > best) {
      best = count;
      stagnant = 0;
    } else {
      stagnant += 1;
    }

    if (step === 1 || step % 5 === 0 || stagnant >= 5) {
      const metrics = await page.evaluate(() => ({
        y: Math.round(window.scrollY),
        viewport: window.innerHeight,
        height: document.documentElement.scrollHeight,
      }));
      samples.push({ step, count, stagnant, ...metrics });
    }

    const lastProduct = page.locator('a[href*="/p/"]').last();
    if (await lastProduct.count()) {
      await lastProduct.scrollIntoViewIfNeeded().catch(() => undefined);
    }
    await page.keyboard.press("End").catch(() => undefined);
    await page.waitForTimeout(900);
  }

  const buttons = (await page.locator("button").allInnerTexts())
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value && value.length <= 120)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 80);
  const paginationLinks = await page.locator('a[href*="page"], a[rel="next"]').evaluateAll((nodes) =>
    nodes.slice(0, 40).map((node) => ({
      text: (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 100),
      href: node.href,
      rel: node.getAttribute("rel"),
    })),
  );

  console.log("AY_PAGINATION_DIAGNOSTIC_BEGIN");
  console.log(JSON.stringify({
    bestProductLinks: best,
    requests,
    requestCounts: requests.reduce((acc, item) => {
      acc[item.endpoint] = (acc[item.endpoint] ?? 0) + 1;
      return acc;
    }, {}),
    samples,
    buttons,
    paginationLinks,
  }));
  console.log("AY_PAGINATION_DIAGNOSTIC_END");
} finally {
  await browser.close();
}
