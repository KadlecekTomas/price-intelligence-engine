import * as cheerio from "cheerio";

const target = "https://www.aboutyou.cz/c/muzi/boty-20215";
const keywords = [
  "graphql",
  "storefront",
  "scayle",
  "pagination",
  "cursor",
  "offset",
  "loadmore",
  "load-more",
  "listing",
  "productsearch",
  "product",
  "catalog",
  "search",
];

function around(text, needle, width = 160) {
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
    /https?:\\?\/\\?\/[^"'`\\\s]{8,240}/gi,
    /["'`](\/[^"'`\s]{1,220})["'`]/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = (match[1] ?? match[0]).replace(/\\\//g, "/");
      const folded = value.toLowerCase();
      if (!keywords.some((keyword) => folded.includes(keyword))) continue;
      if (value.length <= 260) values.add(value);
      if (values.size >= 120) return [...values];
    }
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

const chosen = scripts
  .filter((url) => /(?:chunks|webpack|framework|main|app|page|static)/i.test(url))
  .slice(-14);

console.log("AY_SCANNING_BUNDLES", chosen.length);

const allCandidates = new Set();
for (const url of chosen) {
  try {
    const text = await fetchText(url);
    const hits = {};
    for (const keyword of keywords) {
      const snippet = around(text, keyword);
      if (snippet) hits[keyword] = snippet;
    }
    const candidates = candidateStrings(text);
    for (const candidate of candidates) allCandidates.add(candidate);
    if (Object.keys(hits).length || candidates.length) {
      console.log("AY_BUNDLE", JSON.stringify({
        url,
        bytes: text.length,
        hitKeys: Object.keys(hits),
        candidates: candidates.slice(0, 30),
        snippets: Object.fromEntries(Object.entries(hits).slice(0, 5)),
      }));
    }
  } catch (error) {
    console.log("AY_BUNDLE_ERROR", url, error instanceof Error ? error.message : String(error));
  }
}

console.log("AY_ALL_CANDIDATES", JSON.stringify([...allCandidates].slice(0, 160)));
console.log("AY_DISCOVERY_END");
