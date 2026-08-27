import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeJsonCandidate,
  rankEndpointAnalyses,
} from "@/domain/endpoint-analysis";
import type { EndpointCandidate } from "@/lib/discovery-state";

function candidate(overrides: Partial<EndpointCandidate> = {}): EndpointCandidate {
  return {
    id: "c1",
    capturedAt: "2026-08-27T00:00:00Z",
    method: "GET",
    url: "https://shop.test/api/products?offset=0&limit=24",
    status: 200,
    contentType: "application/json",
    bytes: 12000,
    score: 12,
    sampleFile: "responses/0001.json",
    ...overrides,
  };
}

test("detects a product array with pagination and total", () => {
  const payload = {
    pagination: { offset: 0, limit: 24, total: 114359 },
    products: Array.from({ length: 24 }, (_, index) => ({
      id: index + 1,
      name: `Product ${index + 1}`,
      brand: { name: "Brand" },
      price: { current: 999, currency: "CZK" },
      variants: [{ id: `v${index}`, stock: 3, size: "L" }],
    })),
  };

  const result = analyzeJsonCandidate(candidate(), payload);

  assert.equal(result.likelyBulk, true);
  assert.equal(result.productArrays[0]?.path, "$.products");
  assert.equal(result.productArrays[0]?.length, 24);
  assert.ok(result.paginationKeys.some((key) => key.includes("offset")));
  assert.ok(result.numericTotals.some((entry) => entry.value === 114359));
  assert.ok(result.totalScore > result.networkScore);
});

test("does not mark small unrelated JSON as bulk", () => {
  const payload = {
    user: { id: 1, name: "Tom" },
    messages: [{ id: 1, name: "hello" }],
  };

  const result = analyzeJsonCandidate(candidate({ score: 4 }), payload);
  assert.equal(result.likelyBulk, false);
});

test("ranking prefers likely bulk responses", () => {
  const small = analyzeJsonCandidate(
    candidate({ id: "small", score: 20, bytes: 1000 }),
    { product: { id: 1, price: 100 } },
  );
  const bulk = analyzeJsonCandidate(
    candidate({ id: "bulk", score: 8, bytes: 20000 }),
    {
      total: 5000,
      nextCursor: "abc",
      products: Array.from({ length: 20 }, (_, i) => ({
        productId: i,
        name: `P${i}`,
        price: 100,
        variants: [],
      })),
    },
  );

  assert.equal(rankEndpointAnalyses([small, bulk])[0]?.candidateId, "bulk");
});
