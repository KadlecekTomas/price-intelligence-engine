const PRICE_REFRESH_HOURS_UTC = [0, 4, 8, 12, 16, 20];
const PRICE_REFRESH_MINUTE = 17;
const FULL_CATALOG_HOUR_UTC = 1;
const FULL_CATALOG_MINUTE = 23;

export function nextPriceRefreshAt(now = new Date()) {
  for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
    for (const hour of PRICE_REFRESH_HOURS_UTC) {
      const candidate = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + dayOffset,
        hour,
        PRICE_REFRESH_MINUTE,
        0,
        0,
      ));
      if (candidate.getTime() > now.getTime()) return candidate;
    }
  }
  throw new Error("Unable to resolve next price refresh");
}

export function nextFullCatalogAt(now = new Date()) {
  const today = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    FULL_CATALOG_HOUR_UTC,
    FULL_CATALOG_MINUTE,
    0,
    0,
  ));
  if (today.getTime() > now.getTime()) return today;
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    FULL_CATALOG_HOUR_UTC,
    FULL_CATALOG_MINUTE,
    0,
    0,
  ));
}

export function nextCatalogMaintenanceAt(now: Date, priceRefreshReady: boolean) {
  const full = nextFullCatalogAt(now);
  if (!priceRefreshReady) return full;
  const prices = nextPriceRefreshAt(now);
  return prices.getTime() < full.getTime() ? prices : full;
}
