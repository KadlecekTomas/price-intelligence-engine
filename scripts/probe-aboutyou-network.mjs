import { chromium } from "playwright";

const TARGET = "https://www.aboutyou.cz/c/muzi/boty-20215";
const NEEDLES = ["GetProductStreamPageV2", "GetProductStreamV2", "CategoryStreamService"];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "cs-CZ",
  timezoneId: "Europe/Prague",
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();

const matchingBundles = [];
const streamRequests = [];

page.on("request", (request) => {
  const url = request.url();
  if (!/CategoryStreamService\/GetProductStream(?:Page)?V2/i.test(url)) return;
  const body = request.postDataBuffer();
  streamRequests.push({
    url,
    method: request.method(),
    contentType: request.headers()["content-type"] ?? null,
    xGrpcWeb: request.headers()["x-grpc-web"] ?? null,
    authorizationPresent: Boolean(request.headers().authorization),
    cookiePresent: Boolean(request.headers().cookie),
    bodyBytes: body?.length ?? 0,
  });
});

page.on("response", async (response) => {
  const url = response.url();
  if (!url.includes("assets.aboutstatic.com") || !/\.js(?:\?|$)/i.test(url)) return;
  try {
    const text = await response.text();
    const hits = NEEDLES.filter((needle) => text.includes(needle));
    if (!hits.length) return;
    const sourceMapMatch = text.match(/\/\/# sourceMappingURL=([^\s]+)/) ?? text.match(/\/\*# sourceMappingURL=([^*]+)\*\//);
    matchingBundles.push({
      url,
      bytes: text.length,
      hits,
      sourceMapUrl: sourceMapMatch?.[1]
        ? new URL(sourceMapMatch[1].trim(), url).toString()
        : `${url}.map`,
    });
  } catch {
    // Ignore opaque/non-text assets.
  }
});

try {
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1_500);
  for (let index = 0; index < 10; index += 1) {
    await page.mouse.wheel(0, 5_000);
    await page.waitForTimeout(750);
    if (streamRequests.some((entry) => entry.url.includes("GetProductStreamPageV2"))) break;
  }
  await page.waitForTimeout(1_500);

  console.log("AY_BUNDLE_SIGNAL_BEGIN");
  console.log(JSON.stringify({
    matchingBundles,
    streamRequests,
    finalProductLinks: await page.locator('a[href*="/p/"]').evaluateAll(
      (nodes) => new Set(nodes.map((node) => node.href.split("?")[0])).size,
    ),
  }));
  console.log("AY_BUNDLE_SIGNAL_END");
} finally {
  await browser.close();
}
