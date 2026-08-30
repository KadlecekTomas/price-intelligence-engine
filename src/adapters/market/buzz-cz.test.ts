import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBuzzCollectionUrl,
  extractBuzzCandidateUrls,
  parseBuzzCatalogCount,
} from "@/adapters/market/buzz-cz";
import { parseMarketSearchIntent } from "@/domain/market-search";

const intent = parseMarketSearchIntent("Nike Air Force 1");

test("buildBuzzCollectionUrl maps exact product to public collection slug", () => {
  assert.equal(buildBuzzCollectionUrl(intent), "https://www.buzzsneakers.cz/produkty/nike-air-force-1");
});

test("parseBuzzCatalogCount reads Czech item count", () => {
  const html = `<html><body><h1>Nike Air Force</h1><div>24 Položky</div></body></html>`;
  assert.equal(parseBuzzCatalogCount(html), 24);
});

test("extractBuzzCandidateUrls keeps matching PDP routes only", () => {
  const collection = "https://www.buzzsneakers.cz/produkty/nike-air-force-1";
  const html = `
    <html><body>
      <a href="/tenisky/6901-nike-air-force-1">Nike Air Force 1</a>
      <a href="/tenisky/7000-adidas-samba-og">adidas Samba OG</a>
      <a href="/produkty/nike-air-force-1">collection</a>
      <a href="https://example.com/tenisky/6901-nike-air-force-1">external</a>
    </body></html>
  `;

  assert.deepEqual(extractBuzzCandidateUrls(html, intent, collection), [
    "https://www.buzzsneakers.cz/tenisky/6901-nike-air-force-1",
  ]);
});
