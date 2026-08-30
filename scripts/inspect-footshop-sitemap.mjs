const INDEX_URL = 'https://sitemaps.footshop.cz/sitemaps/sitemap_1_index.xml';

const response = await fetch(INDEX_URL, {
  headers: {
    Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
    'User-Agent': 'PriceIntelligence/0.1 (+https://github.com/KadlecekTomas/price-intelligence-engine)',
  },
  signal: AbortSignal.timeout(15000),
});

console.log('FOOTSHOP_SITEMAP_STATUS', response.status);
const xml = await response.text();
console.log('FOOTSHOP_SITEMAP_BYTES', xml.length);
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
console.log('FOOTSHOP_SITEMAP_LOCS', locs.length);
for (const loc of locs.slice(0, 80)) console.log('FOOTSHOP_SITEMAP_LOC', loc);
