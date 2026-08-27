export type SizeAvailability = "yes" | "no" | "unknown";

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeSize(value: string) {
  const normalized = stripDiacritics(value)
    .toUpperCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(/,/g, ".")
    .replace(/×/g, "X");

  const waist = normalized.match(/^W(\d{2})(?:\/|X)L?(\d{2})$/);
  if (waist) return `W${waist[1]}/L${waist[2]}`;

  return normalized;
}

function explicitSizeSegment(text: string) {
  const normalized = stripDiacritics(text).replace(/\u00a0/g, " ");
  return normalized.match(
    /Dostupne velikosti:\s*(.*?)(?:Pridat do kosiku|Puvodne:|Posledni nejnizsi cena:|$)/i,
  )?.[1] ?? null;
}

export function extractAvailableSizes(text: string) {
  const explicit = explicitSizeSegment(text);
  if (!explicit) return [];

  const matches = explicit.match(
    /W\s*\d{2}\s*(?:\/|X)\s*L?\s*\d{2}|XXXL|XXL|XL|XXS|XS|L|M|S|(?:3[5-9]|4[0-9]|5[0-2])(?:[.,]5)?/gi,
  ) ?? [];

  return [...new Set(matches.map(normalizeSize))];
}

export function sizeAvailabilityFromText(text: string, requestedSize: string): SizeAvailability {
  const available = extractAvailableSizes(text);
  if (available.length > 0) {
    return available.includes(normalizeSize(requestedSize)) ? "yes" : "no";
  }

  const normalizedText = stripDiacritics(text).toLocaleLowerCase("cs-CZ");
  if (/dostupne v mnoha velikostech/.test(normalizedText)) return "unknown";
  return "unknown";
}
