import assert from "node:assert/strict";
import test from "node:test";
import {
  extractZalandoCandidateUrls,
  parseZalandoCatalogCount,
} from "@/adapters/market/zalando-cz";
import { parseMarketSearchIntent } from "@/domain/market-search";

const intent = parseMarketSearchIntent("Nike Air Force 1");

test("parseZalandoCatalogCount reads Czech product count", () => {
  const html = `<html><body><h1>Nike Air Force 1</h1><div>98 produktů</div></body></html>`;
  assert.equal(parseZalandoCatalogCount(html), 98);
});

test("extractZalandoCandidateUrls keeps matching product PDPs only", () => {
  const html = `
    <html><body>
      <a href="/nike-sportswear-air-force-1-tenisky-white-ni111a0xd-a11.html">
        Nike Sportswear AIR FORCE 1 07 - Tenisky - white 2 400 Kč
      </a>
      <a href="/adidas-originals-samba-tenisky-white-ad115o1aa-a11.html">
        adidas Originals SAMBA - Tenisky - white 2 500 Kč
      </a>
      <a href="https://example.com/nike-air-force-1.html">external</a>
      <a href="/katalog/?q=nike">catalog</a>
    </body></html>
  `;

  assert.deepEqual(extractZalandoCandidateUrls(html, intent), [
    "https://www.zalando.cz/nike-sportswear-air-force-1-tenisky-white-ni111a0xd-a11.html",
  ]);
});
