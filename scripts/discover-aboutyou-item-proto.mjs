const MAPS = [
  "https://assets.aboutstatic.com/assets/service.grpc-2Rm69sSU-CxdwnAEx.js.map",
  "https://assets.aboutstatic.com/assets/useIsInteractiveTileActive-CMd7-0Dn.js.map",
];
const NEEDLES = [
  "CategoryStreamItemV2",
  "decodeCategoryStreamItemV2",
  "encodeCategoryStreamItemV2",
  "ProductTile",
  "productTile",
  "currentPrice",
  "lowestPrice",
  "productId",
];

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

function snippets(text, needle, width = 2200, max = 2) {
  const out = [];
  let from = 0;
  while (out.length < max) {
    const index = text.indexOf(needle, from);
    if (index < 0) break;
    out.push(compact(text.slice(Math.max(0, index - width), Math.min(text.length, index + needle.length + width))));
    from = index + needle.length;
  }
  return out;
}

const output = [];
for (const url of MAPS) {
  const response = await fetch(url, {
    headers: { Accept: "application/json,*/*" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  const map = JSON.parse(await response.text());
  const sources = Array.isArray(map.sources) ? map.sources : [];
  const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];

  for (let index = 0; index < contents.length; index += 1) {
    const content = typeof contents[index] === "string" ? contents[index] : "";
    if (!content) continue;
    const source = String(sources[index] ?? `source-${index}`);
    const matched = NEEDLES.filter((needle) => content.includes(needle));
    if (!matched.length && !/stream_v2|product.*tile|price/i.test(source)) continue;

    const hitSnippets = {};
    for (const needle of matched) hitSnippets[needle] = snippets(content, needle);
    output.push({ source, matched, snippets: hitSnippets });
  }
}

console.log("AY_ITEM_PROTO_BEGIN");
console.log(JSON.stringify(output.slice(0, 40)));
console.log("AY_ITEM_PROTO_END");
