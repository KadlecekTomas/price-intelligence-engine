import * as cheerio from "cheerio";

const target = "https://www.aboutyou.cz/c/muzi/boty-20215";
const assetBase = "https://assets.aboutstatic.com";
const keywords = [
  "grpc", "endpoint", "host", "baseurl", "service", "request", "nextrequest",
  "storefront", "scayle", "pagination", "nextstate", "cursor", "offset", "limit",
  "productstream", "brandstream", "categorystream", "categoryid", "filters", "sort",
];

const focusedAssets = [
  "/assets/ProductStreamOffsetLimitPagination-B_rdh_nD.js",
  "/assets/useTokenBasedStreamPages-DT2r0hpa.js",
  "/assets/useProductStreamStatus-hVlO0b9t.js",
  "/assets/SeoStreamPage.eager-CNCjeili.js",
  "/assets/BrandShopStreamHeader-CRVjLO-F.js",
  "/assets/service.grpc-mdxv0dCL-Wo1FjypW.js",
  "/assets/service.grpc-jmurwCah-Dpt8FyBv.js",
  "/assets/service.grpc.lazy-_78VexpA-Ci6O5K2M.js",
  "/assets/service.grpc.lazy-T6u0iCMG-mmQwAI5a.js",
  "/assets/products_service-CUlKocfs.js",
  "/assets/config-CUqyJ_qf.js",
  "/assets/CategoryLegacy.eager-C0rmPScJ.js",
  "/assets/helpers-o9VWAYje-B6AgtHuP.js",
  "/assets/loadingHelpers-C5JTLhjd.js",
];

const mapAssets = [
  "/assets/service.grpc-mdxv0dCL-Wo1FjypW.js.map",
  "/assets/service.grpc-jmurwCah-Dpt8FyBv.js.map",
  "/assets/service.grpc.lazy-_78VexpA-Ci6O5K2M.js.map",
  "/assets/BrandShopStreamHeader-CRVjLO-F.js.map",
  "/assets/SeoStreamPage.eager-CNCjeili.js.map",
  "/assets/CategoryLegacy.eager-C0rmPScJ.js.map",
  "/assets/helpers-o9VWAYje-B6AgtHuP.js.map",
  "/assets/loadingHelpers-C5JTLhjd.js.map",
];

function aroundAll(text, needle, width = 520, max = 4) {
  const lower = text.toLowerCase();
  const key = needle.toLowerCase();
  const results = [];
  let from = 0;
  while (results.length < max) {
    const index = lower.indexOf(key, from);
    if (index < 0) break;
    results.push(text
      .slice(Math.max(0, index - width), Math.min(text.length, index + key.length + width))
      .replace(/\s+/g, " "));
    from = index + key.length;
  }
  return results;
}

function interestingStrings(text) {
  const values = new Set();
  const patterns = [
    /https?:\\?\/\\?\/[^"'`\\\s]{6,360}/gi,
    /["'`]([^"'`]{0,120}\/(?:[^"'`]{0,220})(?:Service|Stream|stream|grpc|api|category|product)[^"'`]{0,120})["'`]/gi,
    /["'`]([^"'`]{0,80}(?:Service|Stream|Request|Response|requestByCategoryId|nextRequest)[^"'`]{0,160})["'`]/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = (match[1] ?? match[0]).replace(/\\\//g, "/").replace(/\s+/g, " ");
      if (value.length >= 3 && value.length <= 420) values.add(value);
      if (values.size >= 180) return [...values];
    }
  }
  return [...values];
}

function assetDependencies(text) {
  const values = new Set();
  for (const match of text.matchAll(/["'`](\/assets\/[^"'`\s]+\.js)["'`]/g)) values.add(match[1]);
  return [...values];
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/javascript,application/json,text/javascript,*/*",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
      "User-Agent": "Mozilla/5.0 PriceIntelligenceDiscovery/1.0",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.text();
}

function summarizeAsset(url, text, tag) {
  const snippets = {};
  for (const keyword of keywords) {
    const hits = aroundAll(text, keyword, 460, 2);
    if (hits.length) snippets[keyword] = hits;
  }
  const dependencies = assetDependencies(text)
    .filter((value) => /grpc|product|pagination|category|search|service|api|stream|filter|config|helper|loading/i.test(value))
    .slice(0, 60);
  const strings = interestingStrings(text);
  console.log(tag, JSON.stringify({
    url,
    bytes: text.length,
    hitKeys: Object.keys(snippets),
    strings: strings.slice(0, 100),
    dependencies,
    snippets,
  }));
  return { dependencies };
}

async function inspectSourceMap(path) {
  const url = new URL(path, assetBase).toString();
  try {
    const raw = await fetchText(url);
    const map = JSON.parse(raw);
    const sources = Array.isArray(map.sources) ? map.sources : [];
    const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];
    console.log("AY_MAP_META", JSON.stringify({ url, bytes: raw.length, sourceCount: sources.length, hasSourcesContent: contents.length > 0 }));

    const selected = [];
    for (let index = 0; index < sources.length; index += 1) {
      const source = String(sources[index]);
      const content = typeof contents[index] === "string" ? contents[index] : "";
      if (!content) continue;
      const combined = `${source}\n${content}`.toLowerCase();
      if (!/(grpc|stream|category|brand|product|pagination|service|api|request)/.test(combined)) continue;

      const snippets = {};
      for (const keyword of keywords) {
        const hits = aroundAll(content, keyword, 700, 3);
        if (hits.length) snippets[keyword] = hits;
      }
      const strings = interestingStrings(content);
      if (Object.keys(snippets).length || strings.length) {
        selected.push({ source, strings: strings.slice(0, 80), snippets });
      }
      if (selected.length >= 18) break;
    }
    console.log("AY_MAP_SELECTED", JSON.stringify({ url, selected }));
  } catch (error) {
    console.log("AY_MAP_ERROR", url, error instanceof Error ? error.message : String(error));
  }
}

console.log("AY_DISCOVERY_START", target);
const html = await fetchText(target);
const $ = cheerio.load(html);
const productLinks = new Set();
$('a[href*="/p/"]').each((_, element) => {
  const href = $(element).attr("href");
  if (href) productLinks.add(new URL(href, target).pathname);
});
console.log("AY_HTML_BYTES", html.length);
console.log("AY_SSR_PRODUCT_LINKS", productLinks.size);
console.log("AY_INLINE_STRINGS", JSON.stringify(interestingStrings(html).slice(0, 100)));

const scriptUrls = [...new Set(
  $('script[src]').map((_, element) => $(element).attr("src")).get().filter(Boolean).map((src) => new URL(src, target).toString()),
)];
console.log("AY_SCRIPT_URLS", JSON.stringify(scriptUrls));

const bootstrapDependencies = new Set();
for (const url of scriptUrls) {
  try {
    const text = await fetchText(url);
    const summary = summarizeAsset(url, text, "AY_BOOTSTRAP");
    for (const dep of summary.dependencies) bootstrapDependencies.add(dep);
  } catch (error) {
    console.log("AY_BOOTSTRAP_ERROR", url, error instanceof Error ? error.message : String(error));
  }
}

const queue = [...new Set([...focusedAssets, ...bootstrapDependencies])];
const recursive = new Set();
for (const path of queue) {
  const url = new URL(path, assetBase).toString();
  try {
    const text = await fetchText(url);
    const summary = summarizeAsset(url, text, "AY_ASSET");
    for (const dep of summary.dependencies) recursive.add(dep);
  } catch (error) {
    console.log("AY_ASSET_ERROR", url, error instanceof Error ? error.message : String(error));
  }
}

for (const path of [...recursive].filter((value) => !queue.includes(value)).slice(0, 30)) {
  const url = new URL(path, assetBase).toString();
  try {
    const text = await fetchText(url);
    summarizeAsset(url, text, "AY_RECURSIVE");
  } catch (error) {
    console.log("AY_RECURSIVE_ERROR", url, error instanceof Error ? error.message : String(error));
  }
}

for (const path of mapAssets) await inspectSourceMap(path);
console.log("AY_DISCOVERY_END");
