import assert from "node:assert/strict";
import test from "node:test";
import { iterateCatalogPages } from "@/catalog/iterate";
import type { CatalogAdapter, CatalogOffer } from "@/catalog/adapter";

function offer(id: number): CatalogOffer {
  return {
    externalProductId: String(id),
    url: `https://shop.test/p/${id}`,
    name: `Product ${id}`,
    currentPriceMinor: 10_000 + id,
    currency: "CZK",
  };
}

function offsetAdapter(total = 250): CatalogAdapter {
  return {
    shopKey: "test",
    market: { countryCode: "CZ", locale: "cs-CZ", currency: "CZK" },
    capabilities: {
      pagination: "offset",
      serverSideBrandFilter: true,
      serverSideCategoryFilter: true,
      serverSideSizeFilter: false,
      variants: false,
      availability: false,
      lowest30dPrice: false,
    },
    roots: [{ key: "all", label: "All" }],
    async fetchPage({ pagination, limit }) {
      assert.equal(pagination.kind, "offset");
      const offset = pagination.kind === "offset" ? pagination.offset : 0;
      const items = Array.from(
        { length: Math.max(0, Math.min(limit, total - offset)) },
        (_, index) => offer(offset + index),
      );
      const nextOffset = offset + items.length;
      return {
        items,
        total,
        next: nextOffset < total ? { kind: "offset", offset: nextOffset } : null,
      };
    },
  };
}

test("iterates an offset catalog until total is exhausted", async () => {
  const adapter = offsetAdapter(250);
  const pages = [];
  for await (const page of iterateCatalogPages(adapter, {
    root: adapter.roots[0]!,
    pageSize: 100,
  })) {
    pages.push(page);
  }

  assert.deepEqual(pages.map((page) => page.items.length), [100, 100, 50]);
  assert.equal(pages.at(-1)?.total, 250);
});

test("rejects an adapter that repeats the same pagination state", async () => {
  const adapter = offsetAdapter(10);
  adapter.fetchPage = async () => ({
    items: [offer(1)],
    total: 10,
    next: { kind: "offset", offset: 0 },
  });

  await assert.rejects(async () => {
    for await (const _page of iterateCatalogPages(adapter, {
      root: adapter.roots[0]!,
      pageSize: 10,
    })) {
      // Consume iterator.
    }
  }, /repeated pagination state/);
});
