const ASSET_BASE = "https://assets.aboutstatic.com";
const MAPS = [
  "/assets/service.grpc-2Rm69sSU-CxdwnAEx.js.map",
  "/assets/useIsInteractiveTileActive-CMd7-0Dn.js.map",
];

const NEEDLES = [
  "GetProductStreamV2Request",
  "GetProductStreamPageV2Request",
  "encodeGetProductStreamV2Request",
  "encodeGetProductStreamPageV2Request",
  "decodeGetProductStreamV2Response",
  "decodeGetProductStreamPageV2Response",
  "GetProductStreamPageV2",
  "GetProductStreamV2",
  "nextState",
  "CategoryStreamService",
];

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

function aroundAll(text, needle, width = 2600, max = 2) {
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

const output = [];
for (const path of MAPS) {
  const url = new URL(path, ASSET_BASE).toString();
  const raw = await fetchText(url);
  const map = JSON.parse(raw);
  const sources = Array.isArray(map.sources) ? map.sources : [];
  const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];

  for (let index = 0; index < contents.length; index += 1) {
    const content = typeof contents[index] === "string" ? contents[index] : "";
    if (!content) continue;
    const source = String(sources[index] ?? `source-${index}`);
    const matchedNeedles = NEEDLES.filter((needle) => content.includes(needle));
    if (!matchedNeedles.length) continue;

    const snippets = {};
    for (const needle of matchedNeedles) {
      snippets[needle] = aroundAll(content, needle, 3200, 1);
    }
    output.push({ map: path, source, matchedNeedles, snippets });
  }
}

console.log("AY_EXACT_PROTO_BEGIN");
console.log(JSON.stringify(output.slice(0, 14)));
console.log("AY_EXACT_PROTO_END");
