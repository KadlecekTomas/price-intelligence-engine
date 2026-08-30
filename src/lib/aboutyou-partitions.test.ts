import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAboutYouPartitionPlan,
  categoryDepth,
  extractAboutYouPartitionLinks,
  inspectAboutYouCategoryHtml,
  partitionKey,
  selectPartitionChildren,
} from "@/lib/aboutyou-partitions";

test("root category extracts only direct men's category children", () => {
  const html = `
    <html><body>
      <h1>Móda pro muže</h1><div>107 718</div><div>Zobrazit</div>
      <a href="/c/muzi/obleceni-20290">Oblečení</a>
      <a href="/c/muzi/boty-20215">Boty</a>
      <a href="/c/muzi/obleceni/tricka-20331">Nested</a>
      <a href="/c/zeny/obleceni-20236">Women</a>
    </body></html>`;
  const inspection = inspectAboutYouCategoryHtml(html, "https://www.aboutyou.cz/c/muzi-20202");
  assert.equal(inspection.reportedCount, 107_718);
  assert.deepEqual(inspection.childCategories, [
    "https://www.aboutyou.cz/c/muzi/boty-20215",
    "https://www.aboutyou.cz/c/muzi/obleceni-20290",
  ]);
});

test("root planning keeps product taxonomy roots and drops overlapping merchandising views", () => {
  const root = "https://www.aboutyou.cz/c/muzi-20202";
  const selected = selectPartitionChildren(root, [
    "https://www.aboutyou.cz/c/muzi/vyprodej-32599",
    "https://www.aboutyou.cz/c/muzi/obleceni-20290",
    "https://www.aboutyou.cz/c/muzi/boty-20215",
    "https://www.aboutyou.cz/c/muzi/sport-20922",
    "https://www.aboutyou.cz/c/muzi/doplnky-20211",
    "https://www.aboutyou.cz/c/muzi/streetwear-20999",
    "https://www.aboutyou.cz/c/muzi/premium-20201",
  ]);
  assert.deepEqual(selected, [
    "https://www.aboutyou.cz/c/muzi/obleceni-20290",
    "https://www.aboutyou.cz/c/muzi/boty-20215",
    "https://www.aboutyou.cz/c/muzi/sport-20922",
    "https://www.aboutyou.cz/c/muzi/doplnky-20211",
  ]);
});

test("nested planning removes merchandising subsets but keeps product taxonomy", () => {
  const current = "https://www.aboutyou.cz/c/muzi/obleceni-20290";
  const selected = selectPartitionChildren(current, [
    "https://www.aboutyou.cz/c/muzi/obleceni/nove-78093",
    "https://www.aboutyou.cz/c/muzi/obleceni/oblibene-99901",
    "https://www.aboutyou.cz/c/muzi/obleceni/prilezitosti-99902",
    "https://www.aboutyou.cz/c/muzi/obleceni/nadmerne-velikosti-99903",
    "https://www.aboutyou.cz/c/muzi/obleceni/tricka-20331",
    "https://www.aboutyou.cz/c/muzi/obleceni/dziny-20332",
  ]);
  assert.deepEqual(selected, [
    "https://www.aboutyou.cz/c/muzi/obleceni/tricka-20331",
    "https://www.aboutyou.cz/c/muzi/obleceni/dziny-20332",
  ]);
});

test("category with only overlapping child views is crawled directly", () => {
  const current = "https://www.aboutyou.cz/c/muzi/obleceni/tricka-20331";
  assert.deepEqual(selectPartitionChildren(current, [
    "https://www.aboutyou.cz/c/muzi/obleceni/tricka/nove-78093",
    "https://www.aboutyou.cz/c/muzi/obleceni/tricka/oblibene-99901",
  ]), []);
});

test("nested category extracts direct children and canonical brand shards", () => {
  const current = "https://www.aboutyou.cz/c/muzi/obleceni-20290";
  const html = `
    <html><body>
      <h1>Oblečení pro muže</h1><div>85 002</div><div>Zobrazit</div>
      <a href="/c/muzi/obleceni/tricka-20331">Trička</a>
      <a href="/c/muzi/obleceni/tricka/tricka-s-kratkym-rukavem-20991">Too deep</a>
      <a href="/c/muzi/obleceni-20290?brand=nike-272&foo=bar">Nike</a>
      <a href="/c/muzi/obleceni-20290?brand=adidas-187">Adidas</a>
    </body></html>`;
  const links = extractAboutYouPartitionLinks(html, current);
  assert.deepEqual(links.childCategories, ["https://www.aboutyou.cz/c/muzi/obleceni/tricka-20331"]);
  assert.deepEqual(links.brandPartitions, [
    "https://www.aboutyou.cz/c/muzi/obleceni-20290?brand=adidas-187",
    "https://www.aboutyou.cz/c/muzi/obleceni-20290?brand=nike-272",
  ]);
});

test("oversized terminal category stays a category instead of using incomplete visible brand links", async () => {
  const root = "https://www.aboutyou.cz/c/muzi-20202";
  const terminal = "https://www.aboutyou.cz/c/muzi/obleceni/tricka-20331";
  const plan = await buildAboutYouPartitionPlan({
    startUrl: root,
    splitAbove: 850,
    inspect: async (url) => {
      if (url === root) {
        return {
          url,
          reportedCount: 10_000,
          childCategories: [terminal],
          brandPartitions: [],
        };
      }
      return {
        url,
        reportedCount: 4_500,
        childCategories: [],
        brandPartitions: [
          `${terminal}?brand=nike-272`,
          `${terminal}?brand=adidas-187`,
        ],
      };
    },
  });

  assert.deepEqual(plan, [{
    key: "/c/muzi/obleceni/tricka-20331",
    url: terminal,
    type: "category",
    parentKey: "/c/muzi-20202",
    depth: 4,
    expectedCount: 4_500,
  }]);
});

test("partition identity is stable across brand ordering", () => {
  assert.equal(
    partitionKey("https://www.aboutyou.cz/c/muzi/obleceni-20290?brand=nike&brand=adidas"),
    "/c/muzi/obleceni-20290?brand=adidas,nike",
  );
  assert.equal(categoryDepth("https://www.aboutyou.cz/c/muzi/obleceni/tricka-20331"), 4);
});
