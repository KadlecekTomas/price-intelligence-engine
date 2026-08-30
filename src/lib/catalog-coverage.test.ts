import assert from "node:assert/strict";
import test from "node:test";
import { assessCatalogCoverage, parseReportedCatalogCount } from "@/lib/catalog-coverage";

test("parseReportedCatalogCount reads standalone Czech catalog totals", () => {
  const text = "Móda pro muže\n107 718\nZobrazit\n3 249 Kč";
  assert.equal(parseReportedCatalogCount(text), 107_718);
});

test("incomplete stagnant crawl can never be published", () => {
  const assessment = assessCatalogCoverage({
    observedProducts: 1_003,
    reportedProducts: 107_718,
    stoppedBecause: "stagnant",
  });
  assert.equal(assessment.publishable, false);
  assert.ok((assessment.coverage ?? 0) < 0.01);
});

test("near-complete reported-total crawl passes the default gate", () => {
  const assessment = assessCatalogCoverage({
    observedProducts: 107_500,
    reportedProducts: 107_718,
    stoppedBecause: "reported-total",
  });
  assert.equal(assessment.publishable, true);
});

test("missing reported total blocks publication even if target was reached", () => {
  const assessment = assessCatalogCoverage({
    observedProducts: 120_000,
    reportedProducts: null,
    stoppedBecause: "target",
  });
  assert.equal(assessment.publishable, false);
});
