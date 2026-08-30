import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryDepth,
  extractAboutYouPartitionLinks,
  inspectAboutYouCategoryHtml,
  partitionKey,
} from "@/lib/aboutyou-partitions";

test("root category extracts only direct men's category children", () => {
  const html = `
    <html><body>
      <div>107 718</div>
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

test("nested category extracts direct children and canonical brand shards", () => {
  const current = "https://www.aboutyou.cz/c/muzi/obleceni-20290";
  const html = `
    <html><body>
      <div>85 002</div>
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

test("partition identity is stable across brand ordering", () => {
  assert.equal(
    partitionKey("https://www.aboutyou.cz/c/muzi/obleceni-20290?brand=nike&brand=adidas"),
    "/c/muzi/obleceni-20290?brand=adidas,nike",
  );
  assert.equal(categoryDepth("https://www.aboutyou.cz/c/muzi/obleceni/tricka-20331"), 4);
});
