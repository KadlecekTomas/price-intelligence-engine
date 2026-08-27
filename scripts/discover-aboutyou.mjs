const ASSET_BASE = "https://assets.aboutstatic.com";
const SERVICE_MAP = "/assets/service.grpc-mdxv0dCL-Wo1FjypW.js.map";
const CALLER_MAPS = [
  "/assets/Category.eager-Dx3Cbvep.js.map",
  "/assets/useTokenBasedStreamPages-DT2r0hpa.js.map",
  "/assets/config-CUqyJ_qf.js.map",
];

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

function aroundAll(text, needle, width = 1800, max = 3) {
  const lower = text.toLowerCase();
  const key = needle.toLowerCase();
  const output = [];
  let from = 0;
  while (output.length < max) {
    const index = lower.indexOf(key, from);
    if (index < 0) break;
    output.push(compact(text.slice(Math.max(0, index - width), Math.min(text.length, index + key.length + width))));
    from = index + key.length;
  }
  return output;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,application/javascript,text/javascript,*/*",
      "User-Agent": "Mozilla/5.0 PriceIntelligenceDiscovery/1.0",
    },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return response.text();
}

async function loadMap(path) {
  const raw = await fetchText(new URL(path, ASSET_BASE).toString());
  const map = JSON.parse(raw);
  return {
    path,
    sources: Array.isArray(map.sources) ? map.sources : [],
    contents: Array.isArray(map.sourcesContent) ? map.sourcesContent : [],
  };
}

const output = { categoryStreamSources: [], callers: [] };

const serviceMap = await loadMap(SERVICE_MAP);
for (let index = 0; index < serviceMap.sources.length; index += 1) {
  const source = String(serviceMap.sources[index] ?? "");
  const content = typeof serviceMap.contents[index] === "string" ? serviceMap.contents[index] : "";
  if (!content) continue;
  if (!/category_page\/v1\/stream/i.test(source) && !/GetProductStream(?:Page)?V2/i.test(content)) continue;

  const hits = {};
  for (const needle of [
    "export interface GetProductStreamV2Request",
    "export interface GetProductStreamPageV2Request",
    "createBaseGetProductStreamV2Request",
    "createBaseGetProductStreamPageV2Request",
    "encodeGetProductStreamV2Request",
    "encodeGetProductStreamPageV2Request",
    "decodeGetProductStreamPageV2Response",
    "GetProductStreamV2",
    "GetProductStreamPageV2",
    "Pagination",
    "nextState",
  ]) {
    const found = aroundAll(content, needle, 2200, 2);
    if (found.length) hits[needle] = found;
  }

  output.categoryStreamSources.push({ source, hits });
}

for (const mapPath of CALLER_MAPS) {
  try {
    const map = await loadMap(mapPath);
    for (let index = 0; index < map.sources.length; index += 1) {
      const source = String(map.sources[index] ?? "");
      const content = typeof map.contents[index] === "string" ? map.contents[index] : "";
      if (!content) continue;
      if (!/(GetProductStreamPageV2|GetProductStreamV2|CategoryStreamService|tadaridaUrl|createTransport)/i.test(content)) continue;
      const hits = {};
      for (const needle of [
        "GetProductStreamV2",
        "GetProductStreamPageV2",
        "CategoryStreamService",
        "tadaridaUrl",
        "createTransport",
        "nextState",
        "token",
      ]) {
        const found = aroundAll(content, needle, 1800, 2);
        if (found.length) hits[needle] = found;
      }
      output.callers.push({ map: mapPath, source, hits });
      if (output.callers.length >= 12) break;
    }
  } catch (error) {
    output.callers.push({ map: mapPath, error: error instanceof Error ? error.message : String(error) });
  }
}

console.log("AY_PROTO_SIGNAL_BEGIN");
console.log(JSON.stringify(output));
console.log("AY_PROTO_SIGNAL_END");
