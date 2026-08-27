"use client";

import { useCallback, useEffect, useState } from "react";

type Status = {
  running: boolean;
  runId: string | null;
  phase: string;
  step: number;
  totalSteps: number;
  productLinks: number;
  jsonResponses: number;
  candidateResponses: number;
  enrichedProducts: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  capabilities: {
    scanAvailable: boolean;
    environment: "local" | "vercel";
    persistence: string;
  };
};

type Candidate = {
  id: string;
  method: string;
  url: string;
  status: number;
  bytes: number;
  score: number;
  sampleFile: string;
};

type Product = {
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
  enriched: boolean;
  material: string | null;
  fit: string | null;
  color: string | null;
  itemNumber: string | null;
  materialScore: number | null;
  buyScore: number | null;
  qualitySignals: string[];
};

const emptyStatus: Status = {
  running: false,
  runId: null,
  phase: "idle",
  step: 0,
  totalSteps: 0,
  productLinks: 0,
  jsonResponses: 0,
  candidateResponses: 0,
  enrichedProducts: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  capabilities: {
    scanAvailable: true,
    environment: "local",
    persistence: "memory-and-local-capture",
  },
};

const verdictLabels: Record<Product["verdict"], string> = {
  NEW_LOW: "NOVÉ MINIMUM",
  TOP: "TOP",
  GOOD: "DOBRÉ",
  OK: "OK",
  EXPENSIVE: "DRAŽŠÍ",
  NO_HISTORY: "BEZ HISTORIE",
};

function money(value: number | null) {
  return value === null ? "—" : `${value.toLocaleString("cs-CZ")} Kč`;
}

export default function Home() {
  const [status, setStatus] = useState<Status>(emptyStatus);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    const [statusResponse, candidatesResponse, productsResponse] = await Promise.all([
      fetch("/api/discovery/status", { cache: "no-store" }),
      fetch("/api/candidates", { cache: "no-store" }),
      fetch("/api/products", { cache: "no-store" }),
    ]);

    if (statusResponse.ok) setStatus(await statusResponse.json());
    if (candidatesResponse.ok) {
      const payload = await candidatesResponse.json();
      setCandidates(payload.candidates ?? []);
    }
    if (productsResponse.ok) {
      const payload = await productsResponse.json();
      setProducts(payload.products ?? []);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!status.capabilities.scanAvailable) return;

    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [refresh, status.capabilities.scanAvailable]);

  async function startDiscovery() {
    if (!status.capabilities.scanAvailable) return;

    setStarting(true);
    try {
      await fetch("/api/discovery/start", { method: "POST" });
      await refresh();
    } finally {
      setStarting(false);
    }
  }

  const hosted = status.capabilities.environment === "vercel";
  const progress = status.totalSteps
    ? Math.min(100, Math.round((status.step / status.totalSteps) * 100))
    : 0;

  const enriched = products.filter((product) => product.enriched && product.material);
  const shortlist = [...enriched]
    .sort((a, b) => (b.buyScore ?? -1) - (a.buyScore ?? -1))
    .slice(0, 24);

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">
            {hosted ? "VERCEL DASHBOARD • CZ MARKET • MULTI-SHOP READY" : "LOCAL SCANNER • CZ MARKET • MULTI-SHOP READY"}
          </p>
          <h1>Price Intelligence Engine</h1>
          <p className="lede">
            Dnešní scan kombinuje cenu vůči 30dennímu minimu s cíleným enrichmentem materiálu u nejzajímavějších pánských kusů.
          </p>
        </div>
        <div className="adapterBadge">
          <span className="dot" />
          ABOUT YOU CZ · Muži
        </div>
      </header>

      <section className="panel controlPanel">
        <div>
          <h2>{hosted ? "Hosted dashboard" : "Scan + shopping shortlist"}</h2>
          <p>
            {hosted
              ? "Dashboard je bezpečně nasazený na Vercelu. Playwright scan zůstává zatím lokální; po připojení databáze a workeru sem potečou perzistentní výsledky automaticky."
              : "Chromium projde aktuální český storefront, najde dealy, u nejlepšího oblečení otevře omezený počet detailů kvůli materiálu a zároveň hledá bulk endpoint pro pozdější kompletní sync."}
          </p>
        </div>
        <button
          onClick={startDiscovery}
          disabled={!status.capabilities.scanAvailable || status.running || starting}
        >
          {hosted
            ? "Scan je zatím lokální"
            : status.running
              ? "Scan běží…"
              : starting
                ? "Spouštím…"
                : "Spustit dnešní scan"}
        </button>
      </section>

      <section className="stats">
        <article className="stat"><span>Prostředí</span><strong>{hosted ? "Vercel" : "Lokální"}</strong></article>
        <article className="stat"><span>Product links</span><strong>{status.productLinks.toLocaleString("cs-CZ")}</strong></article>
        <article className="stat"><span>Materiál ověřen</span><strong>{status.enrichedProducts.toLocaleString("cs-CZ")}</strong></article>
        <article className="stat"><span>Endpoint kandidáti</span><strong>{status.candidateResponses.toLocaleString("cs-CZ")}</strong></article>
      </section>

      <section className="panel progressPanel">
        <div className="progressTop"><span>Průchod katalogem</span><strong>{progress} %</strong></div>
        <div className="progressTrack"><div className="progressValue" style={{ width: `${progress}%` }} /></div>
        <p className="muted">
          {hosted
            ? "Perzistentní data připojíme přes DB + samostatný worker. Vercel zatím slouží jako bezpečný dashboard."
            : `Run: ${status.runId ?? "zatím žádný"}`}
        </p>
        {status.error ? <p className="error">{status.error}</p> : null}
      </section>

      <section className="panel">
        <div className="sectionHeading">
          <div>
            <h2>Shortlist: cena + materiál</h2>
            <p>
              Buy score = 68 % cenový deal + 32 % jednoduchý materiálový signál. Není to objektivní známka zpracování značky; slouží k rychlému vyřazení drahých nebo materiálově slabých kandidátů před nákupem.
            </p>
          </div>
        </div>

        {shortlist.length === 0 ? (
          <div className="empty">
            {hosted
              ? "Hosted dashboard čeká na perzistentní data z workeru."
              : "Po dokončení scanu se tu objeví oblečení s ověřeným materiálem."}
          </div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Buy</th>
                  <th>Deal</th>
                  <th>Materiál</th>
                  <th>Teď</th>
                  <th>30d minimum</th>
                  <th>Produkt</th>
                </tr>
              </thead>
              <tbody>
                {shortlist.map((product) => (
                  <tr key={product.id}>
                    <td><span className="score">{product.buyScore ?? "—"}</span></td>
                    <td>{product.dealScore === null ? "—" : Math.round(product.dealScore)}</td>
                    <td title={product.qualitySignals.join(", ") || undefined}>
                      {product.material ?? "—"}
                    </td>
                    <td>{money(product.currentPriceCzk)}</td>
                    <td>{money(product.lowest30dCzk)}</td>
                    <td className="urlCell">
                      <a href={product.url} target="_blank" rel="noreferrer" title={product.text}>
                        {product.text}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="sectionHeading">
          <div>
            <h2>Všechny nalezené cenové dealy</h2>
            <p>
              Tohle je čistě cenové pořadí. Produkt bez materiálového enrichmentu ještě nepovažujeme za doporučení ke koupi.
            </p>
          </div>
        </div>

        {products.length === 0 ? (
          <div className="empty">
            {hosted ? "Čekáme na DB/worker sync." : "Spusť scan. Jakmile načteme produktové karty, objeví se tu první dnešní dealy."}
          </div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Verdikt</th>
                  <th>Deal score</th>
                  <th>Teď</th>
                  <th>30d minimum</th>
                  <th>Vs. minimum</th>
                  <th>Produkt</th>
                </tr>
              </thead>
              <tbody>
                {products.slice(0, 50).map((product) => (
                  <tr key={product.id}>
                    <td><span className="score">{verdictLabels[product.verdict]}</span></td>
                    <td>{product.dealScore === null ? "—" : Math.round(product.dealScore)}</td>
                    <td>{money(product.currentPriceCzk)}</td>
                    <td>{money(product.lowest30dCzk)}</td>
                    <td>
                      {product.ratioToLow === null
                        ? "—"
                        : `${Math.round((product.ratioToLow - 1) * 100)} %`}
                    </td>
                    <td className="urlCell">
                      <a href={product.url} target="_blank" rel="noreferrer" title={product.text}>
                        {product.text}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="sectionHeading">
          <div>
            <h2>Endpoint discovery</h2>
            <p>Vyšší score = větší šance, že response obsahuje produkty, ceny, varianty nebo pagination.</p>
          </div>
        </div>

        {candidates.length === 0 ? (
          <div className="empty">
            {hosted ? "Endpoint discovery běží pouze v lokálním workeru." : "Scan zároveň analyzuje síť. Tady se objeví zachycené JSON endpointy."}
          </div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Score</th><th>HTTP</th><th>Velikost</th><th>Endpoint</th></tr></thead>
              <tbody>
                {candidates.slice(0, 30).map((candidate) => (
                  <tr key={candidate.id}>
                    <td><span className="score">{candidate.score}</span></td>
                    <td>{candidate.method} · {candidate.status}</td>
                    <td>{Math.round(candidate.bytes / 1024).toLocaleString("cs-CZ")} KB</td>
                    <td className="urlCell" title={candidate.url}>{candidate.url}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer>
        Core engine zůstává shop-agnostic. ABOUT YOU CZ je první adapter; další obchod nebude vyžadovat přepis scoringu ani UI.
      </footer>
    </main>
  );
}
