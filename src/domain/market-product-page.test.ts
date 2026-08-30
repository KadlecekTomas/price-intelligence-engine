import test from "node:test";
import assert from "node:assert/strict";
import { parseMarketProductPage } from "@/domain/market-product-page";

test("parses an in-stock CZK product from JSON-LD", () => {
  const product = parseMarketProductPage(`
    <html><head>
      <script type="application/ld+json">
      {
        "@context":"https://schema.org",
        "@type":"Product",
        "name":"adidas Originals NMD_R1 Core Black",
        "brand":{"@type":"Brand","name":"adidas Originals"},
        "sku":"B37618",
        "gtin13":"4060000000000",
        "color":"Black",
        "offers":{"@type":"Offer","price":"2499","priceCurrency":"CZK","availability":"https://schema.org/InStock"}
      }
      </script>
    </head><body></body></html>
  `);

  assert.ok(product);
  assert.equal(product.title, "adidas Originals NMD_R1 Core Black");
  assert.equal(product.priceCzk, 2499);
  assert.equal(product.availability, "in_stock");
  assert.equal(product.sku, "B37618");
  assert.equal(product.gtin, "4060000000000");
});

test("prefers an available variant over a cheaper sold-out variant", () => {
  const product = parseMarketProductPage(`
    <script type="application/ld+json">
    {
      "@type":"Product",
      "name":"Nike Air Max 90",
      "offers":[
        {"@type":"Offer","price":1999,"priceCurrency":"CZK","availability":"https://schema.org/OutOfStock"},
        {"@type":"Offer","price":2199,"priceCurrency":"CZK","availability":"https://schema.org/InStock","size":"43"}
      ]
    }
    </script>
  `);

  assert.ok(product);
  assert.equal(product.priceCzk, 2199);
  assert.equal(product.availability, "in_stock");
  assert.deepEqual(product.sizes, ["43"]);
});

test("marks explicit Czech sold-out pages as unavailable when JSON-LD is incomplete", () => {
  const product = parseMarketProductPage(`
    <html><head>
      <meta property="og:title" content="adidas NMD_R1" />
      <meta property="product:price:amount" content="3999" />
      <meta property="product:price:currency" content="CZK" />
    </head><body>Tento produkt bohužel již není k dispozici. Vyprodáno.</body></html>
  `);

  assert.ok(product);
  assert.equal(product.availability, "out_of_stock");
});

test("rejects non-CZK offers", () => {
  const product = parseMarketProductPage(`
    <script type="application/ld+json">
      {"@type":"Product","name":"Test","offers":{"@type":"Offer","price":"99","priceCurrency":"EUR"}}
    </script>
  `);
  assert.equal(product, null);
});
