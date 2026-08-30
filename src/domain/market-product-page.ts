import * as cheerio from "cheerio";
import type { OfferAvailability } from "@/domain/market-offer";

export type ParsedMarketProduct = {
  title: string;
  brand: string | null;
  sku: string | null;
  gtin: string | null;
  color: string | null;
  priceCzk: number;
  availability: OfferAvailability;
  sizes: string[];
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function flattenJsonLd(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  const object = asObject(value);
  if (!object) return [];

  const nested: JsonObject[] = [];
  if (object["@graph"]) nested.push(...flattenJsonLd(object["@graph"]));
  if (object.mainEntity) nested.push(...flattenJsonLd(object.mainEntity));
  return [object, ...nested];
}

function typeIncludes(object: JsonObject, expected: string) {
  const type = object["@type"];
  if (Array.isArray(type)) return type.some((item) => String(item).toLowerCase() === expected.toLowerCase());
  return typeof type === "string" && type.toLowerCase() === expected.toLowerCase();
}

function textValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function brandValue(value: unknown) {
  const direct = textValue(value);
  if (direct) return direct;
  const object = asObject(value);
  return object ? textValue(object.name) : null;
}

function normalizeAvailability(value: unknown): OfferAvailability {
  const text = String(value ?? "").toLowerCase();
  if (/instock|limitedavailability|preorder|onlineonly/.test(text)) return "in_stock";
  if (/outofstock|soldout|discontinued/.test(text)) return "out_of_stock";
  return "unknown";
}

function numericPrice(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .replace(/,(?=\d{1,2}$)/, ".")
    .replace(/[^0-9.]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function offerObjects(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap((entry) => offerObjects(entry));
  const object = asObject(value);
  if (!object) return [];
  return [object, ...(object.offers ? offerObjects(object.offers) : [])];
}

function priceFromOffer(offer: JsonObject) {
  return numericPrice(offer.price)
    ?? numericPrice(offer.lowPrice)
    ?? numericPrice(asObject(offer.priceSpecification)?.price);
}

function collectSizes(product: JsonObject, offers: JsonObject[]) {
  const sizes = new Set<string>();
  const add = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(add);
    const text = textValue(value);
    if (text && text.length <= 16) sizes.add(text);
  };
  add(product.size);
  for (const offer of offers) {
    add(offer.size);
    const itemOffered = asObject(offer.itemOffered);
    if (itemOffered) add(itemOffered.size);
  }
  return [...sizes];
}

function firstMeta($: cheerio.CheerioAPI, selectors: string[]) {
  for (const selector of selectors) {
    const content = $(selector).first().attr("content")?.trim();
    if (content) return content;
  }
  return null;
}

export function parseMarketProductPage(html: string): ParsedMarketProduct | null {
  const $ = cheerio.load(html);
  const jsonObjects: JsonObject[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).text().trim();
    if (!raw) return;
    try {
      jsonObjects.push(...flattenJsonLd(JSON.parse(raw)));
    } catch {
      // Invalid third-party JSON-LD must never break the whole market query.
    }
  });

  const product = jsonObjects.find((object) => typeIncludes(object, "Product")) ?? null;
  const offers = product ? offerObjects(product.offers) : [];
  const pricedOffers = offers
    .map((offer) => ({ offer, price: priceFromOffer(offer) }))
    .filter((entry): entry is { offer: JsonObject; price: number } => entry.price !== null)
    .sort((a, b) => a.price - b.price);

  const bestOffer = pricedOffers.find(({ offer }) => normalizeAvailability(offer.availability) !== "out_of_stock")
    ?? pricedOffers[0]
    ?? null;

  const fallbackTitle = firstMeta($, ['meta[property="og:title"]', 'meta[name="twitter:title"]'])
    ?? $("h1").first().text().replace(/\s+/g, " ").trim()
    ?? null;
  const title = textValue(product?.name) ?? fallbackTitle;
  if (!title) return null;

  const fallbackPrice = numericPrice(firstMeta($, [
    'meta[property="product:price:amount"]',
    'meta[itemprop="price"]',
  ]));
  const price = bestOffer?.price ?? fallbackPrice;
  if (price === null || price === undefined) return null;

  const currency = textValue(bestOffer?.offer.priceCurrency)
    ?? textValue(product?.priceCurrency)
    ?? firstMeta($, ['meta[property="product:price:currency"]']);
  if (currency && currency.toUpperCase() !== "CZK") return null;

  let availability = bestOffer ? normalizeAvailability(bestOffer.offer.availability) : "unknown";
  if (availability === "unknown") {
    const body = $("body").text().replace(/\s+/g, " ").toLowerCase();
    if (/vyprod[aá]no|nen[ií]\s+k\s+dispozici|bohu[zž]el\s+ji[zž]\s+nen[ií]\s+k\s+dispozici/.test(body)) {
      availability = "out_of_stock";
    }
  }

  const gtin = textValue(product?.gtin13)
    ?? textValue(product?.gtin14)
    ?? textValue(product?.gtin12)
    ?? textValue(product?.gtin8)
    ?? textValue(product?.gtin);

  return {
    title,
    brand: brandValue(product?.brand),
    sku: textValue(product?.sku) ?? textValue(product?.mpn),
    gtin,
    color: textValue(product?.color),
    priceCzk: Math.round(price),
    availability,
    sizes: product ? collectSizes(product, offers) : [],
  };
}
