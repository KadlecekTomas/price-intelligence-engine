import { inspectAboutYouCategory } from "@/lib/aboutyou-partitions";

async function main() {
  const root = await inspectAboutYouCategory("https://www.aboutyou.cz/c/muzi-20202");
  console.log(`ROOT REPORTED: ${root.reportedCount?.toLocaleString("cs-CZ") ?? "unknown"}`);
  console.log(`DIRECT CHILD CATEGORIES: ${root.childCategories.length}`);
  console.log(`BRAND LINKS: ${root.brandPartitions.length}`);
  for (const url of root.childCategories.slice(0, 20)) console.log(`CATEGORY: ${url}`);

  if (!root.reportedCount || root.reportedCount < 50_000) {
    throw new Error(`ABOUT YOU root reported count is not trustworthy: ${root.reportedCount ?? "missing"}`);
  }
  if (root.childCategories.length < 3) {
    throw new Error(`ABOUT YOU root exposed only ${root.childCategories.length} direct category links`);
  }
}

main().catch((error) => {
  console.error("ABOUT YOU partition probe failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
