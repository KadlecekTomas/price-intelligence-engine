import * as cheerio from "cheerio";

const CATEGORY_URL = "https://www.aboutyou.cz/c/muzi/boty-20215";
const ASSET_BASE = "https://assets.aboutstatic.com";

const ASSETS = [
  "/assets/ProductStreamOffsetLimitPagination-B_rdh_nD.js",
  "/assets/products_service-CUlKocfs.js",
  "/assets/service.grpc-mdxv0dCL-Wo1FjypW.js",
  "/assets/service.grpc-jmurwCah-Dpt8FyBv.js",
  "/assets/service.grpc.lazy-_78VexpA-Ci6O5K2M.js",
  "/assets/service.grpc.lazy-T6u0iCMG-mmQwAI5a.js",
  "/assets/CategoryLegacy.eager-C0rmPScJ.js",
  "/assets/helpers-o9VWAYje-B6AgtHuP.js",
  "/assets/loadingHelpers-C5JTLhjd.js",
];

const NEEDLES = [
  "requestByCategoryId",
  "ProductStream",
  "productStream",
  "createGrpcWebTransport",
  "createConnectTransport",
  "createPromiseClient",
  "serviceName",
  "methodName",
  "baseUrl",
  "baseURL",
  "grpc",
  "offset",
  "nextState",
];

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

function around(text, needle, width = 520) {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return null;
  return compact(text.slice(Math.max(0, index - width), Math.min(text.length, index + needle.length + width)));
}

function literals(text) {
  const values = new Set();
  const patterns = [
    /https?:\\?\/\\?\/[^"'`\\\s<>)]+/gi,
    /["'`]((?:\/)?[A-Za-z0-9_.-]*(?:Product|Catalog|Stream|Category)[A-Za-z0-9_.\/-]*(?:Service)?\/[A-Za-z0-9_.-]+)["'`]/g,
    /["'`]([A-Za-z0-9_.-]+\.(?:Product|Catalog|Stream|Category)[A-Za-z0-9_.-]*Service)["'`]/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = compact((match[1] ?? match[0]).replace(/\\\//g, "/"));
      if (value.length >= 5 && value.length <= 300) values.add(value);
      if (values.size >= 80) return [...values];
    }
  }
  return [...values];
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/javascript,application/json,text/javascript,*/*",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
      "User-Agent": "Mozilla/5.0 PriceIntelligenceDiscovery/1.0",
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.text();
}

function collectSignals(label, text) {
  const snippets = [];
  for (const needle of NEEDLES) {
    const snippet = around(text, needle);
    if (snippet) snippets.push({ needle, snippet });
  }
  return {
    label,
    bytes: text.length,
    literals: literals(text),
    snippets: snippets.slice(0, 10),
  };
}

async function inspectMap(assetPath) {
  const mapUrl = new URL(`${assetPath}.map`, ASSET_BASE).toString();
  try {
    const raw = await fetchText(mapUrl);
    const map = JSON.parse(raw);
    const sources = Array.isArray(map.sources) ? map.sources : [];
    const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];
    const selected = [];

    for (let index = 0; index < contents.length; index += 1) {
      const content = typeof contents[index] === "string" ? contents[index] : "";
      if (!content) continue;
      if (!NEEDLES.some((needle) => content.toLowerCase().includes(needle.toLowerCase()))) continue;
      const signal = collectSignals(String(sources[index] ?? `source-${index}`), content);
      if (signal.snippets.length || signal.literals.length) selected.push(signal);
      if (selected.length >= 8) break;
    }

    return { mapUrl, selected };
  } catch (error) {
    return { mapUrl, error: error instanceof Error ? error.message : String(error), selected: [] };
  }
}

const html = await fetchText(CATEGORY_URL);
const $ = cheerio.load(html);
const productLinks = new Set();
$('a[href*="/p/"]').each((_, element) => {
  const href = $(element).attr("href");
  if (href) productLinks.add(new URL(href, CATEGORY_URL).pathname);
});

const htmlSignals = collectSignals("category-html", html);
const assetSignals = [];
const mapSignals = [];

for (const assetPath of ASSETS) {
  const url = new URL(assetPath, ASSET_BASE).toString();
  try {
    const text = await fetchText(url);
    const signal = collectSignals(assetPath, text);
    if (signal.snippets.length || signal.literals.length) assetSignals.push(signal);
  } catch (error) {
    assetSignals.push({ label: assetPath, error: error instanceof Error ? error.message : String(error) });
  }

  const map = await inspectMap(assetPath);
  if (map.selected.length) mapSignals.push(map);
}

const output = {
  ssrProducts: productLinks.size,
  htmlLiterals: htmlSignals.literals.slice(0, 20),
  htmlSnippets: htmlSignals.snippets.slice(0, 5),
  assets: assetSignals.slice(0, 12),
  maps: mapSignals.slice(0, 12),
};

console.log("AY_HIGH_SIGNAL_BEGIN");
console.log(JSON.stringify(output));
console.log("AY_HIGH_SIGNAL_END");
