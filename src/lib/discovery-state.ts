export type EndpointCandidate = {
  id: string;
  capturedAt: string;
  method: string;
  url: string;
  status: number;
  contentType: string;
  bytes: number;
  score: number;
  sampleFile: string;
};

export type ScannedProduct = {
  id: string;
  url: string;
  text: string;
  currentPriceCzk: number;
  originalPriceCzk: number | null;
  lowest30dCzk: number | null;
  ratioToLow: number | null;
  discountPct: number | null;
  dealScore: number | null;
  verdict: "NEW_LOW" | "TOP" | "GOOD" | "OK" | "EXPENSIVE" | "NO_HISTORY";
};

export type DiscoveryState = {
  running: boolean;
  runId: string | null;
  phase: string;
  step: number;
  totalSteps: number;
  productLinks: number;
  jsonResponses: number;
  candidateResponses: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  candidates: EndpointCandidate[];
  products: ScannedProduct[];
};

const initialState: DiscoveryState = {
  running: false,
  runId: null,
  phase: "idle",
  step: 0,
  totalSteps: 0,
  productLinks: 0,
  jsonResponses: 0,
  candidateResponses: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  candidates: [],
  products: [],
};

const globalState = globalThis as typeof globalThis & {
  __priceIntelligenceDiscovery?: DiscoveryState;
};

export const discoveryState =
  globalState.__priceIntelligenceDiscovery ?? structuredClone(initialState);

globalState.__priceIntelligenceDiscovery = discoveryState;
