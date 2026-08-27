export type CatalogPagination =
  | { kind: "offset"; offset: number }
  | { kind: "cursor"; cursor: string | null };

export type CatalogMarket = {
  countryCode: string;
  locale: string;
  currency: string;
};

export type CatalogRoot = {
  key: string;
  label: string;
  externalId?: string | null;
  url?: string | null;
};

export type CatalogFilters = {
  categoryIds?: string[];
  brandIds?: string[];
  colors?: string[];
  materials?: string[];
  sizes?: string[];
  minPriceMinor?: number | null;
  maxPriceMinor?: number | null;
  extra?: Record<string, string | number | boolean | string[] | null>;
};

export type CatalogVariant = {
  externalVariantId: string;
  label?: string | null;
  size?: string | null;
  color?: string | null;
  ean?: string | null;
  available: boolean | null;
  stock?: number | null;
  metadata?: Record<string, unknown>;
};

export type CatalogOffer = {
  externalProductId: string;
  url: string;
  name: string;
  brand?: string | null;
  brandExternalId?: string | null;
  categoryExternalIds?: string[];
  color?: string | null;
  material?: string | null;
  currentPriceMinor: number;
  originalPriceMinor?: number | null;
  lowest30dPriceMinor?: number | null;
  currency: string;
  available?: boolean | null;
  variants?: CatalogVariant[];
  metadata?: Record<string, unknown>;
};

export type CatalogPageRequest = {
  root: CatalogRoot;
  pagination: CatalogPagination;
  limit: number;
  filters?: CatalogFilters;
};

export type CatalogPage = {
  items: CatalogOffer[];
  total: number | null;
  next: CatalogPagination | null;
  sourceMetadata?: Record<string, unknown>;
};

export type CatalogCapabilities = {
  pagination: "offset" | "cursor" | "hybrid";
  serverSideBrandFilter: boolean;
  serverSideCategoryFilter: boolean;
  serverSideSizeFilter: boolean;
  variants: boolean;
  availability: boolean;
  lowest30dPrice: boolean;
};

export interface CatalogAdapter {
  readonly shopKey: string;
  readonly market: CatalogMarket;
  readonly capabilities: CatalogCapabilities;
  readonly roots: readonly CatalogRoot[];

  fetchPage(request: CatalogPageRequest): Promise<CatalogPage>;
}

export function initialPagination(adapter: CatalogAdapter): CatalogPagination {
  return adapter.capabilities.pagination === "cursor"
    ? { kind: "cursor", cursor: null }
    : { kind: "offset", offset: 0 };
}
