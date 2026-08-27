import type { ShopAdapter } from "@/adapters/types";

export const aboutYouCzMen: ShopAdapter = {
  id: "aboutyou-cz",
  name: "ABOUT YOU CZ",
  market: "CZ",
  currency: "CZK",
  discovery: {
    startUrl: "https://www.aboutyou.cz/c/muzi-20202",
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    productLinkSelector: 'a[href*="/p/"]',
    candidateUrlPattern:
      /(api|graphql|product|listing|search|catalog|category|variant|scayle|pagination|filter)/i,
  },
};
