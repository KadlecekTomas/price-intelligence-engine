import {
  initialPagination,
  type CatalogAdapter,
  type CatalogFilters,
  type CatalogPage,
  type CatalogPagination,
  type CatalogRoot,
} from "@/catalog/adapter";

export type IterateCatalogOptions = {
  root: CatalogRoot;
  filters?: CatalogFilters;
  pageSize?: number;
  maxPages?: number;
};

function paginationKey(value: CatalogPagination) {
  return value.kind === "offset"
    ? `offset:${value.offset}`
    : `cursor:${value.cursor ?? "<start>"}`;
}

export async function* iterateCatalogPages(
  adapter: CatalogAdapter,
  options: IterateCatalogOptions,
): AsyncGenerator<CatalogPage> {
  const pageSize = Math.max(1, Math.min(Math.round(options.pageSize ?? 100), 500));
  const maxPages = Math.max(1, Math.round(options.maxPages ?? 10_000));
  const seen = new Set<string>();
  let pagination: CatalogPagination | null = initialPagination(adapter);

  for (let pageIndex = 0; pagination && pageIndex < maxPages; pageIndex += 1) {
    const key = paginationKey(pagination);
    if (seen.has(key)) {
      throw new Error(`Catalog adapter repeated pagination state: ${key}`);
    }
    seen.add(key);

    const page = await adapter.fetchPage({
      root: options.root,
      pagination,
      limit: pageSize,
      filters: options.filters,
    });

    if (page.total !== null && page.total < 0) {
      throw new Error("Catalog adapter returned a negative total");
    }

    yield page;

    if (page.items.length === 0) break;
    pagination = page.next;
  }
}
