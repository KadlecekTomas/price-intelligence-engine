import { chromium } from "playwright";

const TARGET = "https://www.aboutyou.cz/c/muzi/boty-20215";
const METHOD_HINT = "GetProductStreamV2";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "cs-CZ",
  timezoneId: "Europe/Prague",
  viewport: { width: 1440, height: 1000 },
});

const page = await context.newPage();
const captures = [];

function relevant(url) {
  const lower = url.toLowerCase();
  return lower.includes(METHOD_HINT.toLowerCase())
    || lower.includes("category_page")
    || lower.includes("categorystreamservice")
    || (lower.includes("grpc") && lower.includes("stream"));
}

page.on("request", (request) => {
  if (!relevant(request.url())) return;
  const headers = request.headers();
  const body = request.postDataBuffer();
  captures.push({
    phase: "request",
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType(),
    contentType: headers["content-type"] ?? null,
    accept: headers.accept ?? null,
    grpcWeb: headers["x-grpc-web"] ?? null,
    userAgentHeaderPresent: Boolean(headers["x-user-agent"]),
    authorizationPresent: Boolean(headers.authorization),
    cookiePresent: Boolean(headers.cookie),
    headerNames: Object.keys(headers).filter((name) => !["cookie", "authorization"].includes(name)).sort(),
    bodyBytes: body?.length ?? 0,
    bodyBase64: body && body.length <= 16_384 ? body.toString("base64") : null,
  });
});

page.on("response", async (response) => {
  if (!relevant(response.url())) return;
  const headers = response.headers();
  let bodyBytes = null;
  try {
    bodyBytes = (await response.body()).length;
  } catch {
    bodyBytes = null;
  }
  captures.push({
    phase: "response",
    url: response.url(),
    status: response.status(),
    contentType: headers["content-type"] ?? null,
    grpcStatus: headers["grpc-status"] ?? null,
    bodyBytes,
  });
});

try {
  await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(2_000);

  for (let index = 0; index < 12; index += 1) {
    await page.mouse.wheel(0, 5_000);
    await page.waitForTimeout(900);
    if (captures.some((capture) => capture.phase === "request" && capture.bodyBytes > 0)) break;
  }

  await page.waitForTimeout(2_000);
  console.log("AY_NETWORK_SIGNAL_BEGIN");
  console.log(JSON.stringify({
    target: TARGET,
    captureCount: captures.length,
    captures: captures.slice(0, 12),
    finalProductLinks: await page.locator('a[href*="/p/"]').evaluateAll((nodes) => new Set(nodes.map((node) => node.href.split("?")[0])).size),
  }));
  console.log("AY_NETWORK_SIGNAL_END");
} finally {
  await browser.close();
}
