const HEADERS = {
  Accept: 'application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8',
  'User-Agent': 'PriceIntelligence/0.1 (+https://github.com/KadlecekTomas/price-intelligence-engine)',
};

async function fetchText(url, timeout = 20000) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
  const text = await response.text();
  console.log('FETCH', response.status, text.length, url);
  return { response, text };
}

async function inspectShop(label, indexUrl) {
  const { text: xml } = await fetchText(indexUrl);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  console.log(`${label}_SITEMAP_LOCS`, locs.length);
  for (const loc of locs) console.log(`${label}_SITEMAP_LOC`, loc);
  const productSitemap = locs.find((loc) => loc.includes('sitemap_products_'));
  if (!productSitemap) return;
  const { text: productsXml } = await fetchText(productSitemap, 30000);
  const productLocs = [...productsXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  console.log(`${label}_PRODUCTS_COUNT`, productLocs.length);
  console.log(`${label}_PRODUCTS_FIRST`, productLocs[0] ?? 'NONE');
  const nmdMatches = productLocs.filter((loc) => /adidas[^<]*(?:nmd.?r1|nmdr1)/i.test(loc));
  console.log(`${label}_NMD_MATCHES`, nmdMatches.length);
  for (const loc of nmdMatches.slice(0, 20)) console.log(`${label}_NMD_URL`, loc);
}

await inspectShop('FOOTSHOP', 'https://sitemaps.footshop.cz/sitemaps/sitemap_1_index.xml');

const { text: queensRobots } = await fetchText('https://www.queens.cz/robots.txt');
const queensSitemaps = queensRobots
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^sitemap:/i.test(line))
  .map((line) => line.replace(/^sitemap:\s*/i, ''));
console.log('QUEENS_ROBOTS_SITEMAPS', queensSitemaps.length);
for (const url of queensSitemaps) console.log('QUEENS_ROBOTS_SITEMAP', url);
const queensCatalog = queensSitemaps.find((url) => /sitemaps\//i.test(url));
if (queensCatalog) await inspectShop('QUEENS', queensCatalog);
