import assert from "node:assert/strict";
import test from "node:test";
import { nextCatalogMaintenanceAt, nextFullCatalogAt, nextPriceRefreshAt } from "@/lib/catalog-schedule";

test("price refresh advances to next four-hour UTC slot", () => {
  assert.equal(
    nextPriceRefreshAt(new Date("2026-08-30T11:28:00Z")).toISOString(),
    "2026-08-30T12:17:00.000Z",
  );
});

test("full catalog runs daily at 01:23 UTC", () => {
  assert.equal(
    nextFullCatalogAt(new Date("2026-08-30T11:28:00Z")).toISOString(),
    "2026-08-31T01:23:00.000Z",
  );
});

test("before verified partitions the next maintenance is the full catalog run", () => {
  assert.equal(
    nextCatalogMaintenanceAt(new Date("2026-08-30T11:28:00Z"), false).toISOString(),
    "2026-08-31T01:23:00.000Z",
  );
});
