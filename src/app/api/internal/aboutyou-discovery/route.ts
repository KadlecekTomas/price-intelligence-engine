import * as cheerio from "cheerio";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ABOUT_YOU = "https://www.aboutyou.cz";
const KEYWORDS = [
  "graphql",
  "storefront",
  "scayle",
  "pagination",
  "cursor",
  "offset",
  "loadmore",
  "load-more",
  "listing",
  "products",
  "productsearch",
  "search",
] as const;

function safeCategoryPath(value: string | null) {
  if (!value) return "/c/muzi/boty-20215";
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.startsWith("/c/muzi")) return "/c/muzi/boty-20215";
    if (decoded.includes("..")) return "/c/muzi/boty-20215";
    return decoded.slice(0, 500);
  } catch {
    return "/c/muzi/boty-20215";
  }
}

function normalizeScriptUrl(src: string, baseUrl: string) {
  try {
    const url = new URL(src, baseUrl);
    if (!url.hostname.endsWith("aboutyou.cz") && !url.hostname.endsWith("aboutstatic.com")) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function snippets(text: string, keyword: string, limit = 3) {
  const lower = text.toLowerCase();
  const found: string[] = [];
  let from = 0;

  while (found.length < limit) {
    const index = lower.indexOf(keyword, from);
    if (index < 0) break;
    const start = Math.max(0, index - 180);
    const end = Math.min(text.length, index + keyword.length + 260);
    found.push(text.slice(start, end).replace(/\s+/g, " "));
    from = index + keyword.length;
  }

  return found;
}

function extractCandidateStrings(text: string) {
  const candidates = new Set<string>();
  const patterns = [
    /https?:\\?\/\\?\/[^"'`\\\s]{8,220}/gi,
    /["'`](\/[^"'`\s]{2,180}(?:api|graphql|product|listing|search|catalog|pagination|cursor|offset)[^"'`\s]{0,180})["'`]/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = (match[1] ?? match[0]).replace(/\\\//g, "/");
      if (value.length <= 300) candidates.add(value);
      if (candidates.size >= 80) return [...candidates];
    }
  }

  return [...candidates];
}

async function scanBundle(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/javascript,text/javascript,*/*" },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });

  if (!response.ok) {
    return { url, ok: false as const, status: response.status, bytes: 0, hits: {}, candidates: [] };
  }

  const text = await response.text();
  const hits: Record<string, string[]> = {};
  for (const keyword of KEYWORDS) {
    const values = snippets(text, keyword, 2);
    if (values.length > 0) hits[keyword] = values;
  }

  return {
    url,
    ok: true as const,
    status: response.status,
    bytes: text.length,
    hits,
    candidates: extractCandidateStrings(text),
  };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const categoryPath = safeCategoryPath(requestUrl.searchParams.get("path"));
  const targetUrl = new URL(categoryPath, ABOUT_YOU).toString();

  const response = await fetch(targetUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.6",
    },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json({ error: `ABOUT YOU returned ${response.status}`, targetUrl }, { status: 502 });
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const productLinks = new Set<string>();
  $('a[href*="/p/"]').each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const url = new URL(href, targetUrl);
      url.search = "";
      url.hash = "";
      productLinks.add(url.toString());
    } catch {
      // Ignore malformed public hrefs.
    }
  });

  const scriptUrls = [...new Set(
    $('script[src]')
      .map((_, element) => $(element).attr("src") ?? "")
      .get()
      .map((src) => normalizeScriptUrl(src, targetUrl))
      .filter((value): value is string => Boolean(value)),
  )];

  const inlineText = $('script:not([src])')
    .map((_, element) => $(element).text())
    .get()
    .join("\n");

  const inlineHits: Record<string, string[]> = {};
  for (const keyword of KEYWORDS) {
    const values = snippets(inlineText, keyword, 3);
    if (values.length > 0) inlineHits[keyword] = values;
  }

  const shouldScanBundles = requestUrl.searchParams.get("scan") === "1";
  const bundleLimit = Math.max(1, Math.min(Number(requestUrl.searchParams.get("bundles") ?? "8") || 8, 12));
  const likelyBundles = scriptUrls
    .filter((url) => /(?:chunks|webpack|framework|main|app|page)/i.test(url))
    .slice(-bundleLimit);

  const bundleScans = shouldScanBundles
    ? await Promise.all(likelyBundles.map((url) => scanBundle(url).catch((error) => ({
        url,
        ok: false as const,
        status: 0,
        bytes: 0,
        hits: { error: [error instanceof Error ? error.message : "unknown error"] },
        candidates: [],
      }))))
    : [];

  return NextResponse.json({
    temporaryDiagnostic: true,
    targetUrl,
    fetchedAt: new Date().toISOString(),
    htmlBytes: html.length,
    uniqueProductLinksInSsr: productLinks.size,
    sampleProductLinks: [...productLinks].slice(0, 5),
    scriptCount: scriptUrls.length,
    scriptUrls,
    inlineHits,
    inlineCandidates: extractCandidateStrings(inlineText),
    scannedBundleCount: bundleScans.length,
    bundleScans,
  });
}
