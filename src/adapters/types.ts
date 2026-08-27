import type { Currency, Market } from "@/domain/types";

export type ShopAdapter = {
  id: string;
  name: string;
  market: Market;
  currency: Currency;
  discovery: {
    startUrl: string;
    locale: string;
    timezoneId: string;
    productLinkSelector: string;
    candidateUrlPattern: RegExp;
  };
};
