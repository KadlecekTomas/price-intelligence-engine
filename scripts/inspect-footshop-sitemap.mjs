const INDEX_URL = 'https://sitemaps.footshop.cz/sitemaps/sitemap_1_index.xml';
const HEADERS = {
  Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'PriceIntelligence/0.1 (+https://github.com/KadlecekTomas/price-intelligence-engine)',
};

const response = await fetch(INDEX_URL, {
  headers: HEADERS,
  signal: AbortSignal.timeout(15000),
});

console.log('FOOTSHOP_SITEMAP_STATUS', response.status);
const xml = await response.text();
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
console.log('FOOTSHOP_SITEMAP_LOCS', locs.length);
for (const loc of locs) console.log('FOOTSHOP_SITEMAP_LOC', loc);

const productSitemap = locs.find((loc) => loc.includes('sitemap_products_'));
if (!productSitemap) throw new Error('Product sitemap missing');

const productsResponse = await fetch(productSitemap, {
  headers: HEADERS,
  signal: AbortSignal.timeout(20000),
});
console.log('FOOTSHOP_PRODUCTS_STATUS', productsResponse.status);
const productsXml = await productsResponse.text();
const productLocs = [...productsXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
console.log('FOOTSHOP_PRODUCTS_BYTES', productsXml.length);
console.log('FOOTSHOP_PRODUCTS_COUNT', productLocs.length);
console.log('FOOTSHOP_PRODUCTS_FIRST', productLocs[0] ?? 'NONE');
const nmdMatches = productLocs.filter((loc) => /adidas[^<]*(?:nmd.?r1|nmdr1)/i.test(loc));
console.log('FOOTSHOP_NMD_MATCHES', nmdMatches.length);
for (const loc of nmdMatches.slice(0, 20)) console.log('FOOTSHOP_NMD_URL', loc);
