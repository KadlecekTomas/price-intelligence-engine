import * as cheerio from "cheerio";

const target = "https://www.aboutyou.cz/c/muzi/boty-20215";
const assetBase = "https://assets.aboutstatic.com";
const keywords = [
  "graphql",
  "storefront",
  "scayle",
  "pagination",
  "cursor",
  "offset",
  "limit",
  "pagesize",
  "loadmore",
  "load-more",
  "listing",
  "productstream",
  "productsearch",
  "products_service",
  "categoryid",
  "filters",
  "sort",
  "product",
  "catalog",
  "search",
];

const focusedAssets = [
  "/assets/ProductStreamOffsetLimitPagination-B_rdh_nD.js",
  "/assets/products_service-CUlKocfs.js",
  "/assets/pagination-t--I1k8_-B5-bt73r.js",
  "/assets/SearchResults.eager-CtzBd5yy.js",
  "/assets/SearchPageResolver-BALfcgCJ.js",
  "/assets/useProductStreamStatus-hVlO0b9t.js",
  "/assets/useProductStreamDisplayState-DoImK_yF.js",
];

function around(text, needle, width = 420) {
  const lower = text.toLowerCase();
  const index = lower.indexOf(needle.toLowerCase());
  if (index < 0) return null;
  return text
    .slice(Math.max(0, index - width), Math.min(text.length, index + needle.length + width))
    .replace(/\s+/g, " ");
}

function candidateStrings(text) {
  const values = new Set();
  const patterns = [
    /https?:\\?\/\\?\/[^"'`\\\s]{8,300}/gi,
    /["'`](\/[^"'`\s]{1,260})["'`]/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = (match[1] ?? match[0]).replace(/\\\//g, "/");
      const folded = value.toLowerCase();
      if (!keywords.some((keyword) => folded.includes(keyword))) continue;
      if (value.length <= 320) values.add(value);
      if (values.size >= 160) return [...values];
    }
  }
  return [...values];
}

function assetDependencies(text) {
  const values = new Set();
  for (const match of text.matchAll(/["'`](\/assets\/[^"'`\s]+\.js)["'`]/g)) {
    values.add(match[1]);
  }
  return [...values];
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/javascript,text/javascript,*/*",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
      "User-Agent": "Mozilla/5.0 PriceIntelligenceDiscovery/1.0",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.text();
}

function summarizeAsset(url, text, tag) {
  const hits = {};
  for (const keyword of keywords) {
    const snippet = around(text, keyword);
    if (snippet) hits[keyword] = snippet;
  }
  const candidates = candidateStrings(text);
  const dependencies = assetDependencies(text)
    .filter((value) => /product|pagination|category|search|service|api|stream|filter/i.test(value))
    .slice(0, 40);

  console.log(tag, JSON.stringify({
    url,
    bytes: text.length,
    hitKeys: Object.keys(hits),
    candidates: candidates.slice(0, 80),
    dependencies,
    snippets: hits,
  }));

  return { candidates, dependencies };
}

console.log("AY_DISCOVERY_START", target);
const html = await fetchText(target);
const $ = cheerio.load(html);
const productLinks = new Set();
$('a[href*="/p/"]').each((_, element) => {
  const href = $(element).attr("href");
  if (href) productLinks.add(new URL(href, target).pathname);
});

const scripts = [...new Set(
  $('script[src]')
    .map((_, element) => $(element).attr("src"))
    .get()
    .filter(Boolean)
    .map((src) => new URL(src, target).toString()),
)];

console.log("AY_HTML_BYTES", html.length);
console.log("AY_SSR_PRODUCT_LINKS", productLinks.size);
console.log("AY_SCRIPT_COUNT", scripts.length);
console.log("AY_INLINE_CANDIDATES", JSON.stringify(candidateStrings(html).slice(0, 80)));

const bootstrap = scripts
  .filter((url) => /(?:index|chunks|webpack|framework|main|app|page|static)/i.test(url))
  .slice(-4);

const discoveredDependencies = new Set();
for (const url of bootstrap) {
  try {
    const text = await fetchText(url);
    const summary = summarizeAsset(url, text, "AY_BOOTSTRAP");
    for (const dependency of summary.dependencies) discoveredDependencies.add(dependency);
  } catch (error) {
    console.log("AY_BOOTSTRAP_ERROR", url, error instanceof Error ? error.message : String(error));
  }
}

const queue = [...new Set([...focusedAssets, ...discoveredDependencies])];
const recursivelyDiscovered = new Set();
console.log("AY_FOCUSED_ASSET_COUNT", queue.length);

for (const path of queue) {
  const url = new URL(path, assetBase).toString();
  try {
    const text = await fetchText(url);
    const summary = summarizeAsset(url, text, "AY_FOCUSED");
    for (const dependency of summary.dependencies) recursivelyDiscovered.add(dependency);
  } catch (error) {
    console.log("AY_FOCUSED_ERROR", url, error instanceof Error ? error.message : String(error));
  }
}

for (const path of [...recursivelyDiscovered].filter((value) => !queue.includes(value)).slice(0, 20)) {
  const url = new URL(path, assetBase).toString();
  try {
    const text = await fetchText(url);
    summarizeAsset(url, text, "AY_RECURSIVE");
  } catch (error) {
    console.log("AY_RECURSIVE_ERROR", url, error instanceof Error ? error.message : String(error));
  }
}

console.log("AY_DISCOVERY_END");
