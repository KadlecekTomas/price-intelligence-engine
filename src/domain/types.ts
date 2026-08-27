export type Currency = "CZK";
export type Market = "CZ";

export type ProductSnapshot = {
  shopId: string;
  market: Market;
  externalProductId: string;
  name: string;
  brand: string;
  productUrl: string;
  capturedAt: string;
  currentPriceCzk: number;
  originalPriceCzk: number | null;
  external30DayLowCzk: number | null;
};

export type VariantSnapshot = {
  externalVariantId: string;
  size: string | null;
  inStock: boolean;
  currentPriceCzk: number | null;
};
