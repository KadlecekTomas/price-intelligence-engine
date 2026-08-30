import { load } from "cheerio";
import { parseReportedCatalogCount } from "@/lib/catalog-coverage";

const ABOUTYOU_HOST = "www.aboutyou.cz";
const MEN_ROOT_PATH = "/c/muzi-20202";
const MEN_CATEGORY_PREFIX = "/c/muzi/";
const PRIMARY_ROOT_CATEGORY = /^\/c\/muzi\/(?:obleceni|boty|sport|doplnky)-\d+$/;
const OVERLAPPING_CATEGORY_SLUGS = new Set([
  "nove",
  "oblibene",
  "prilezitosti",
  "exkluzivne",
  "upcyklace",
  "vyprodej",
  "top-100",
  "nadmerne-velikosti",
  "druhy-sportu",
]);

const HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.6",
  "User-Agent": "PriceIntelligence/0.1 (+https://github.com/KadlecekTomas/price-intelligence-engine)",
};

export type AboutYouPartitionType = "category" | "brand";

export type AboutYouPartition = {
  key: string;
  url: string;
  type: AboutYouPartitionType;
  parentKey: string | null;
  depth: number;
  expectedCount: number | null;
};

export type AboutYouCategoryInspection = {
  url: string;
  reportedCount: number | null;
  childCategories: string[];
  brandPartitions: string[];
};

function stripCategoryId(pathname: string) {
  return pathname.replace(/-\d+$/, "");
}

function lastCategorySlug(urlValue: string) {
  const pathname = new URL(urlValue).pathname;
  const segment = pathname.split("/").filter(Boolean).at(-1) ?? "";
  return segment.replace(/-\d+$/, "");
}

function canonicalCategoryUrl(raw: string, baseUrl: string) {
  try {
    const url = new URL(raw, baseUrl);
    if (url.protocol !== "https:" || url.hostname !== ABOUTYOU_HOST) return null;
    if (url.pathname !== MEN_ROOT_PATH && !url.pathname.startsWith(MEN_CATEGORY_PREFIX)) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function partitionKey(urlValue: string) {
  const url = new URL(urlValue);
  const brand = url.searchParams.getAll("brand").sort().join(",");
  return brand ? `${url.pathname}?brand=${brand}` : url.pathname;
}

export function categoryDepth(urlValue: string) {
  const url = new URL(urlValue);
  return url.pathname.split("/").filter(Boolean).length;
}

export function selectPartitionChildren(currentUrl: string, childCategories: string[]) {
  const current = new URL(currentUrl);
  if (current.pathname === MEN_ROOT_PATH) {
    const primary = childCategories.filter((value) => PRIMARY_ROOT_CATEGORY.test(new URL(value).pathname));
    return primary.length >= 3 ? primary : childCategories;
  }

  const taxonomyChildren = childCategories.filter((value) => !OVERLAPPING_CATEGORY_SLUGS.has(lastCategorySlug(value)));
  return taxonomyChildren.length > 0 ? taxonomyChildren : childCategories;
}

export function extractAboutYouPartitionLinks(html: string, currentUrl: string) {
  const $ = load(html);
  const current = new URL(currentUrl);
  const currentPath = current.pathname;
  const directPrefix = currentPath === MEN_ROOT_PATH
    ? MEN_CATEGORY_PREFIX
    : `${stripCategoryId(currentPath)}/`;
  const directDepth = directPrefix.split("/").filter(Boolean).length + 1;
  const childCategories = new Set<string>();
  const brandPartitions = new Set<string>();

  $("a[href]").each((_, element) => {
    const raw = $(element).attr("href");
    if (!raw) return;
    const url = canonicalCategoryUrl(raw, currentUrl);
    if (!url) return;

    const hasBrand = url.searchParams.has("brand");
    if (hasBrand && url.pathname === currentPath) {
      const canonical = new URL(url.origin + url.pathname);
      for (const brand of [...new Set(url.searchParams.getAll("brand"))].sort()) {
        canonical.searchParams.append("brand", brand);
      }
      brandPartitions.add(canonical.toString());
      return;
    }

    if (hasBrand || url.pathname === currentPath) return;
    if (!url.pathname.startsWith(directPrefix)) return;
    if (url.pathname.split("/").filter(Boolean).length !== directDepth) return;
    url.search = "";
    childCategories.add(url.toString());
  });

  return {
    childCategories: [...childCategories].sort(),
    brandPartitions: [...brandPartitions].sort(),
  };
}

export function inspectAboutYouCategoryHtml(html: string, currentUrl: string): AboutYouCategoryInspection {
  const $ = load(html);
  const text = $("body").text();
  const links = extractAboutYouPartitionLinks(html, currentUrl);
  return {
    url: currentUrl,
    reportedCount: parseReportedCatalogCount(text),
    ...links,
  };
}

export async function inspectAboutYouCategory(urlValue: string): Promise<AboutYouCategoryInspection> {
  const url = canonicalCategoryUrl(urlValue, urlValue);
  if (!url) throw new Error(`Unsupported ABOUT YOU category URL: ${urlValue}`);

  const response = await fetch(url, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`ABOUT YOU category inspection failed (${response.status}) for ${url}`);
  const html = await response.text();
  if (html.length < 10_000) throw new Error(`ABOUT YOU category inspection returned unexpectedly small HTML for ${url}`);
  return inspectAboutYouCategoryHtml(html, url.toString());
}

export async function buildAboutYouPartitionPlan(options: {
  startUrl?: string;
  splitAbove?: number;
  maxDepth?: number;
  maxPartitions?: number;
  inspect?: (url: string) => Promise<AboutYouCategoryInspection>;
  onInspect?: (inspection: AboutYouCategoryInspection) => void | Promise<void>;
} = {}) {
  const startUrl = options.startUrl ?? `https://${ABOUTYOU_HOST}${MEN_ROOT_PATH}`;
  const splitAbove = Math.max(250, Math.min(options.splitAbove ?? 850, 5_000));
  const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 8, 12));
  const maxPartitions = Math.max(10, Math.min(options.maxPartitions ?? 2_000, 5_000));
  const inspect = options.inspect ?? inspectAboutYouCategory;
  const queue: Array<{ url: string; parentKey: string | null }> = [{ url: startUrl, parentKey: null }];
  const inspected = new Set<string>();
  const leaves: AboutYouPartition[] = [];

  while (queue.length > 0) {
    const next = queue.shift()!;
    const key = partitionKey(next.url);
    if (inspected.has(key)) continue;
    inspected.add(key);
    if (inspected.size > maxPartitions) throw new Error(`Partition plan exceeded ${maxPartitions} inspected nodes`);

    const inspection = await inspect(next.url);
    await options.onInspect?.(inspection);
    const depth = categoryDepth(next.url);
    const expectedCount = inspection.reportedCount;
    const shouldSplit = expectedCount === null || expectedCount > splitAbove;
    const categoryChildren = selectPartitionChildren(next.url, inspection.childCategories);

    if (shouldSplit && depth < maxDepth && categoryChildren.length > 0) {
      for (const child of categoryChildren) queue.push({ url: child, parentKey: key });
      continue;
    }

    // Do not substitute a terminal category with the visible brand links. ABOUT
    // YOU exposes only a merchandising subset of brands as anchors (typically
    // top brands), not an exhaustive brand facet. Using those links as shards
    // silently drops every product from non-visible brands. A terminal category
    // is therefore always crawled directly; the sync worker scales its step
    // budget from the category's reported product count.
    leaves.push({
      key,
      url: next.url,
      type: "category",
      parentKey: next.parentKey,
      depth,
      expectedCount,
    });
  }

  const uniqueLeaves = new Map(leaves.map((partition) => [partition.key, partition]));
  return [...uniqueLeaves.values()].sort((a, b) => a.key.localeCompare(b.key));
}
