import test from "node:test";
import assert from "node:assert/strict";
import {
  findFootshopCandidateUrls,
  parseSitemapUrls,
} from "@/adapters/market/footshop-cz";
import { parseMarketSearchIntent } from "@/domain/market-search";

test("parses only Czech Footshop product URLs from sitemap XML", () => {
  const urls = parseSitemapUrls(`
    <urlset>
      <url><loc>https://www.footshop.cz/cs/panske-tenisky-a-boty/1-adidas-nmdr1-black.html</loc></url>
      <url><loc>https://www.footshop.cz/cs/tricka/2-nike-shirt.html?x=1&amp;y=2</loc></url>
      <url><loc>https://www.example.com/product</loc></url>
    </urlset>
  `);

  assert.deepEqual(urls, [
    "https://www.footshop.cz/cs/panske-tenisky-a-boty/1-adidas-nmdr1-black.html",
    "https://www.footshop.cz/cs/tricka/2-nike-shirt.html?x=1&y=2",
  ]);
});

test("finds exact model candidates despite compact NMD_R1 slug spelling", () => {
  const intent = parseMarketSearchIntent("adidas nmd r1 nejlevnější");
  const candidates = findFootshopCandidateUrls([
    "https://www.footshop.cz/cs/panske-tenisky-a-boty/1-adidas-nmdr1-core-black.html",
    "https://www.footshop.cz/cs/panske-tenisky-a-boty/2-adidas-samba-og.html",
    "https://www.footshop.cz/cs/panske-tenisky-a-boty/3-nike-air-max-90.html",
  ], intent);

  assert.deepEqual(candidates, [
    "https://www.footshop.cz/cs/panske-tenisky-a-boty/1-adidas-nmdr1-core-black.html",
  ]);
});
