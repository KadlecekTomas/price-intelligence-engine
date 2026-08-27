const CATEGORY_URL = "https://www.aboutyou.cz/c/muzi/boty-20215";
const ASSET_BASE = "https://assets.aboutstatic.com";

const MAPS = [
  "/assets/service.grpc-mdxv0dCL-Wo1FjypW.js.map",
  "/assets/Category.eager-Dx3Cbvep.js.map",
  "/assets/CategoryLegacy.eager-C0rmPScJ.js.map",
  "/assets/useTokenBasedStreamPages-DT2r0hpa.js.map",
  "/assets/useProductStreamStatus-hVlO0b9t.js.map",
  "/assets/config-CUqyJ_qf.js.map",
];

const SOURCE_NEEDLES = [
  "CategoryStreamService/GetProductStreamV2",
  "GetProductStreamV2",
  "GetProductStreamRequest",
  "GetProductStreamV2Request",
  "requestByCategoryId",
  "createGrpcWebTransport",
  "createConnectTransport",
  "Transport",
  "tadarida",
  "grpc",
  "baseUrl",
  "apiUrl",
  "endpoint",
];

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

function occurrences(text, needle, width = 900, max = 3) {
  const lower = text.toLowerCase();
  const key = needle.toLowerCase();
  const results = [];
  let from = 0;
  while (results.length < max) {
    const index = lower.indexOf(key, from);
    if (index < 0) break;
    results.push(compact(text.slice(Math.max(0, index - width), Math.min(text.length, index + key.length + width))));
    from = index + key.length;
  }
  return results;
}

function urls(text) {
  const result = new Set();
  for (const match of text.matchAll(/https?:\\?\/\\?\/[^"'`\\\s<>)]+/gi)) {
    const value = (match[0] ?? "").replace(/\\\//g, "/");
    if (value.length < 350) result.add(value);
    if (result.size >= 80) break;
  }
  return [...result];
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

const output = {
  html: {},
  sources: [],
};

const html = await fetchText(CATEGORY_URL);
for (const needle of [
  "CategoryStreamService/GetProductStreamV2",
  "aysa_api.services.category_page",
  "tadarida",
  "grpc",
  "apiUrl",
  "baseUrl",
]) {
  const hits = occurrences(html, needle, 1100, 2);
  if (hits.length) output.html[needle] = hits;
}
output.html.urls = urls(html).filter((value) => /aboutyou|aysa|tadarida|api|grpc|scayle/i.test(value)).slice(0, 30);

for (const mapPath of MAPS) {
  const mapUrl = new URL(mapPath, ASSET_BASE).toString();
  try {
    const raw = await fetchText(mapUrl);
    const map = JSON.parse(raw);
    const sources = Array.isArray(map.sources) ? map.sources : [];
    const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];

    for (let index = 0; index < contents.length; index += 1) {
      const content = typeof contents[index] === "string" ? contents[index] : "";
      if (!content) continue;
      const source = String(sources[index] ?? `source-${index}`);
      const haystack = `${source}\n${content}`.toLowerCase();
      if (!SOURCE_NEEDLES.some((needle) => haystack.includes(needle.toLowerCase()))) continue;

      const hits = {};
      for (const needle of SOURCE_NEEDLES) {
        const found = occurrences(content, needle, 1300, 2);
        if (found.length) hits[needle] = found;
      }
      if (!Object.keys(hits).length) continue;

      output.sources.push({
        map: mapPath,
        source,
        urls: urls(content).filter((value) => /aboutyou|aysa|tadarida|api|grpc|scayle/i.test(value)).slice(0, 20),
        hits,
      });
      if (output.sources.length >= 20) break;
    }
  } catch (error) {
    output.sources.push({ map: mapPath, error: error instanceof Error ? error.message : String(error) });
  }
}

console.log("AY_STREAM_SIGNAL_BEGIN");
console.log(JSON.stringify(output));
console.log("AY_STREAM_SIGNAL_END");
