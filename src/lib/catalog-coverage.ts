export type CatalogStopReason = "reported-total" | "target" | "stagnant" | "max-steps";

export type CatalogCoverageAssessment = {
  observedProducts: number;
  reportedProducts: number | null;
  coverage: number | null;
  minimumCoverage: number;
  publishable: boolean;
  reason: string;
};

function normalizeCandidate(value: string) {
  const parsed = Number(value.replace(/[ .\u00a0]/g, ""));
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 500_000 ? parsed : null;
}

export function parseReportedCatalogCount(text: string) {
  const normalized = text.replace(/\u00a0/g, " ");
  const candidates = new Set<number>();

  for (const line of normalized.split(/\r?\n/).map((value) => value.trim())) {
    if (!/^\d{1,3}(?:[ .]\d{3})+$/.test(line) && !/^\d{4,6}$/.test(line)) continue;
    const value = normalizeCandidate(line);
    if (value !== null) candidates.add(value);
  }

  for (const match of normalized.matchAll(/(?:^|\D)(\d{1,3}(?:[ .]\d{3})+)(?=\D|$)/g)) {
    const value = normalizeCandidate(match[1]);
    if (value !== null) candidates.add(value);
  }

  return candidates.size > 0 ? Math.max(...candidates) : null;
}

export function coverageRatio(observedProducts: number, reportedProducts: number | null) {
  if (!reportedProducts || reportedProducts <= 0) return null;
  return observedProducts / reportedProducts;
}

export function assessCatalogCoverage(input: {
  observedProducts: number;
  reportedProducts: number | null;
  stoppedBecause: CatalogStopReason;
  minimumCoverage?: number;
}): CatalogCoverageAssessment {
  const minimumCoverage = Math.max(0.9, Math.min(input.minimumCoverage ?? 0.995, 1));
  const coverage = coverageRatio(input.observedProducts, input.reportedProducts);

  if (!input.reportedProducts) {
    return {
      observedProducts: input.observedProducts,
      reportedProducts: null,
      coverage,
      minimumCoverage,
      publishable: false,
      reason: "Source did not expose a trustworthy reported catalog total",
    };
  }

  if (coverage === null || coverage < minimumCoverage) {
    return {
      observedProducts: input.observedProducts,
      reportedProducts: input.reportedProducts,
      coverage,
      minimumCoverage,
      publishable: false,
      reason: `Coverage ${(100 * (coverage ?? 0)).toFixed(2)}% is below ${(100 * minimumCoverage).toFixed(2)}%`,
    };
  }

  if (input.stoppedBecause === "stagnant" || input.stoppedBecause === "max-steps") {
    return {
      observedProducts: input.observedProducts,
      reportedProducts: input.reportedProducts,
      coverage,
      minimumCoverage,
      publishable: false,
      reason: `Crawler stopped because of ${input.stoppedBecause}; incomplete runs are never publishable`,
    };
  }

  return {
    observedProducts: input.observedProducts,
    reportedProducts: input.reportedProducts,
    coverage,
    minimumCoverage,
    publishable: true,
    reason: "Coverage gate passed",
  };
}
