import { chromium, type Page } from "playwright";

const START_URL = "https://www.aboutyou.cz/c/muzi-20202";
const PAGE_REQUEST = /CategoryStreamService\/GetProductStreamPageV2/i;

async function acceptConsent(page: Page) {
  for (const name of [/přijmout/i, /souhlasím/i, /accept/i]) {
    const button = page.getByRole("button", { name }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => undefined);
      return;
    }
  }
}

function scalarPreview(value: unknown) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    if (value.length <= 120) return JSON.stringify(value);
    return `string(${value.length})`;
  }
  if (value === null) return "null";
  return typeof value;
}

function summarize(value: unknown, path = "$", depth = 0, lines: string[] = []) {
  if (lines.length >= 180 || depth > 6) return lines;
  if (Array.isArray(value)) {
    lines.push(`${path}: array(${value.length})`);
    if (value.length > 0) summarize(value[0], `${path}[0]`, depth + 1, lines);
    return lines;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    lines.push(`${path}: object keys=[${keys.slice(0, 40).join(", ")}]${keys.length > 40 ? "…" : ""}`);
    const interesting = keys.filter((key) => /product|article|item|price|page|count|total|offset|cursor|category|brand|id|result/i.test(key));
    const selected = [...new Set([...interesting, ...keys.slice(0, 10)])].slice(0, 28);
    for (const key of selected) {
      const child = record[key];
      if (child && typeof child === "object") summarize(child, `${path}.${key}`, depth + 1, lines);
      else lines.push(`${path}.${key}: ${scalarPreview(child)}`);
      if (lines.length >= 180) break;
    }
    return lines;
  }
  lines.push(`${path}: ${scalarPreview(value)}`);
  return lines;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      locale: "cs-CZ",
      timezoneId: "Europe/Prague",
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.6" },
    });
    const page = await context.newPage();
    const firstStreamResponse = page
      .waitForResponse((response) => PAGE_REQUEST.test(response.url()), { timeout: 30_000 })
      .catch(() => null);

    await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await acceptConsent(page);
    await page.waitForTimeout(800);
    await page.keyboard.press("End").catch(() => undefined);

    const response = await firstStreamResponse;
    if (!response) throw new Error("No GetProductStreamPageV2 response observed");

    const contentType = response.headers()["content-type"] ?? "unknown";
    const bytes = await response.body();
    console.log(`STREAM URL: ${response.url()}`);
    console.log(`STATUS: ${response.status()}`);
    console.log(`CONTENT-TYPE: ${contentType}`);
    console.log(`BYTES: ${bytes.byteLength}`);

    if (/grpc-web\+proto/i.test(contentType)) {
      console.log("STREAM FORMAT: protobuf gRPC-web");
      console.log("DECISION: do not reverse-engineer protobuf for catalog completeness; use public category partitions + reported counts.");
      return;
    }

    if (/json/i.test(contentType)) {
      const body: unknown = JSON.parse(bytes.toString("utf8"));
      console.log("\nSTRUCTURE");
      for (const line of summarize(body)) console.log(line);
      return;
    }

    throw new Error(`Unexpected stream content type: ${contentType}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("ABOUT YOU stream probe failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
