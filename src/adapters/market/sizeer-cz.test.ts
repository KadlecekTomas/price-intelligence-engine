import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSizeerCollectionUrl,
  extractSizeerCandidateUrls,
  parseSizeerCatalogCount,
} from "@/adapters/market/sizeer-cz";
import { parseMarketSearchIntent } from "@/domain/market-search";

const intent = parseMarketSearchIntent("Nike Air Force 1");

test("buildSizeerCollectionUrl maps exact product to public collection slug", () => {
  assert.equal(buildSizeerCollectionUrl(intent), "https://sizeer.cz/nike-air-force-1");
});

test("parseSizeerCatalogCount reads Czech result count", () => {
  const html = `<html><body><h1>Nike Air Force 1 (78)</h1><div>z 78 výsledků</div></body></html>`;
  assert.equal(parseSizeerCatalogCount(html), 78);
});

test("extractSizeerCandidateUrls keeps matching same-origin PDP links only", () => {
  const collection = "https://sizeer.cz/nike-air-force-1";
  const html = `
    <html><body>
      <a href="/nike-air-force-1-07-panske-tenisky-seda-ib3080-001">Nike Air Force 1 07</a>
      <a href="/adidas-samba-og-bila-b75806">adidas Samba OG</a>
      <a href="https://example.com/nike-air-force-1-07">external</a>
      <a href="/nike-air-force-1">collection</a>
    </body></html>
  `;

  assert.deepEqual(extractSizeerCandidateUrls(html, intent, collection), [
    "https://sizeer.cz/nike-air-force-1-07-panske-tenisky-seda-ib3080-001",
  ]);
});
