import assert from "node:assert/strict";
import test from "node:test";
import { aboutYouCategoryUrl, parseAboutYouCategoryHtml } from "@/adapters/aboutyou-cz-live";
import { parseNaturalSearch } from "@/domain/natural-search";

const HTML = `
<!doctype html>
<html lang="cs">
  <body>
    <main>
      <article data-card="1">
        <a href="/p/tommy-hilfiger/tricko-brand-love-12345?tracking=abc">
          <span>TOMMY HILFIGER</span><span>Tričko 'BRAND LOVE'</span>
        </a>
        <div>589 Kč</div>
        <div>Dostupné velikosti: S, M, L, XL</div>
        <div>Původně: 999 Kč</div>
        <div>Poslední nejnižší cena: 345 Kč</div>
      </article>
      <article data-card="2">
        <a href="https://www.aboutyou.cz/p/levis/tricko-perfect-4848562">
          <span>LEVI'S ®</span><span>Tričko Perfect</span>
        </a>
        <div>519 Kč</div>
        <div>Dostupné velikosti: XS, S, M, L</div>
        <div>Původně: 619 Kč</div>
        <div>Poslední nejnižší cena: 208 Kč</div>
      </article>
    </main>
  </body>
</html>`;

test("maps category and verified color to current ABOUT YOU CZ URL", () => {
  const intent = parseNaturalSearch("černé tričko L do 1500");
  assert.equal(
    aboutYouCategoryUrl(intent),
    "https://www.aboutyou.cz/c/muzi/obleceni/tricka-20324?color=38932",
  );
});

test("maps verified material together with color", () => {
  const intent = parseNaturalSearch("černé tričko L do 1500, bavlna");
  assert.equal(
    aboutYouCategoryUrl(intent),
    "https://www.aboutyou.cz/c/muzi/obleceni/tricka-20324?color=38932&materialStyle=35459",
  );
  assert.equal(
    aboutYouCategoryUrl(intent, { color: "černá", material: null }),
    "https://www.aboutyou.cz/c/muzi/obleceni/tricka-20324?color=38932",
  );
  assert.equal(
    aboutYouCategoryUrl(intent, { color: null, material: "bavlna" }),
    "https://www.aboutyou.cz/c/muzi/obleceni/tricka-20324?materialStyle=35459",
  );
});

test("falls back to the men root category", () => {
  const intent = parseNaturalSearch("ukaž nejlepší věci");
  assert.equal(aboutYouCategoryUrl(intent), "https://www.aboutyou.cz/c/muzi-20202");
});

test("parses SSR product cards, preserves word boundaries and canonicalizes URLs", () => {
  const products = parseAboutYouCategoryHtml(
    HTML,
    "https://www.aboutyou.cz/c/muzi/obleceni/tricka-20324",
  );

  assert.equal(products.length, 2);
  const tommy = products.find((product) => product.url.includes("brand-love"));
  assert.ok(tommy);
  assert.equal(tommy.currentPriceCzk, 589);
  assert.equal(tommy.originalPriceCzk, 999);
  assert.equal(tommy.lowest30dCzk, 345);
  assert.equal(tommy.url.includes("tracking"), false);
  assert.equal(tommy.text.includes("TOMMY HILFIGER Tričko 'BRAND LOVE'"), true);
  assert.equal(tommy.text.includes("Dostupné velikosti: S, M, L, XL"), true);

  const levis = products.find((product) => product.url.includes("tricko-perfect"));
  assert.ok(levis);
  assert.equal(levis.text.includes("LEVI'S ® Tričko Perfect"), true);
});

test("annotates constraints when the source category is filtered", () => {
  const products = parseAboutYouCategoryHtml(
    HTML,
    "https://www.aboutyou.cz/c/muzi/obleceni/tricka-20324?color=38932&materialStyle=35459",
    "černá",
    "bavlna",
    "exact",
  );
  assert.equal(products.every((product) => product.color === "černá"), true);
  assert.equal(
    products.every((product) => product.qualitySignals.includes("ABOUT YOU filtr: materiál=bavlna")),
    true,
  );
  assert.equal(
    products.every((product) => product.qualitySignals.includes("ABOUT YOU live: exact")),
    true,
  );
});

test("does not confuse multiple products in a broad parent container", () => {
  const products = parseAboutYouCategoryHtml(
    HTML,
    "https://www.aboutyou.cz/c/muzi/obleceni/tricka-20324",
  );
  const prices = products.map((product) => product.currentPriceCzk).sort((a, b) => a - b);
  assert.deepEqual(prices, [519, 589]);
});
