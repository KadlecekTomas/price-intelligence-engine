import { buildAboutYouPartitionPlan, inspectAboutYouCategory } from "@/lib/aboutyou-partitions";

async function main() {
  const startUrl = "https://www.aboutyou.cz/c/muzi-20202";
  const root = await inspectAboutYouCategory(startUrl);
  console.log(`ROOT REPORTED: ${root.reportedCount?.toLocaleString("cs-CZ") ?? "unknown"}`);
  console.log(`DIRECT CHILD CATEGORIES: ${root.childCategories.length}`);
  console.log(`VISIBLE BRAND LINKS: ${root.brandPartitions.length}`);
  for (const url of root.childCategories.slice(0, 20)) console.log(`CATEGORY: ${url}`);

  if (!root.reportedCount || root.reportedCount < 50_000 || root.reportedCount > 200_000) {
    throw new Error(`ABOUT YOU root reported count is not trustworthy: ${root.reportedCount ?? "missing"}`);
  }
  if (root.childCategories.length < 3) {
    throw new Error(`ABOUT YOU root exposed only ${root.childCategories.length} direct category links`);
  }

  const plan = await buildAboutYouPartitionPlan({
    startUrl,
    splitAbove: 850,
    maxPartitions: 2_000,
  });
  const brandLeaves = plan.filter((partition) => partition.type === "brand");
  const unknownLeaves = plan.filter((partition) => partition.expectedCount === null);
  const largestLeaves = [...plan]
    .sort((a, b) => (b.expectedCount ?? -1) - (a.expectedCount ?? -1))
    .slice(0, 12);

  console.log(`PLAN LEAVES: ${plan.length}`);
  console.log(`BRAND LEAVES: ${brandLeaves.length}`);
  console.log(`UNKNOWN-COUNT LEAVES: ${unknownLeaves.length}`);
  for (const leaf of largestLeaves) {
    console.log(`LEAF: ${leaf.key} · expected ${leaf.expectedCount?.toLocaleString("cs-CZ") ?? "unknown"}`);
  }

  if (plan.length < 4 || plan.length > 2_000) {
    throw new Error(`ABOUT YOU partition plan has implausible leaf count: ${plan.length}`);
  }
  if (brandLeaves.length > 0) {
    throw new Error(`Partition plan still contains ${brandLeaves.length} non-exhaustive visible-brand leaves`);
  }
  if (unknownLeaves.length > 0) {
    throw new Error(`Partition plan still has ${unknownLeaves.length} leaves without a trustworthy reported total`);
  }
}

main().catch((error) => {
  console.error("ABOUT YOU partition probe failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
