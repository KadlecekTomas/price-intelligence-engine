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
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
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
  startedAt: null,
  finishedAt: null,
  error: null,
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
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function startDiscovery() {
    setStarting(true);
    try {
      await fetch("/api/discovery/start", { method: "POST" });
      await refresh();
    } finally {
      setStarting(false);
    }
  }

  const progress = status.totalSteps
    ? Math.min(100, Math.round((status.step / status.totalSteps) * 100))
    : 0;

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">LOCAL • CZ MARKET • MULTI-SHOP READY</p>
          <h1>Price Intelligence Engine</h1>
          <p className="lede">
            Hledáme současný datový zdroj a zároveň už z načtených produktových karet počítáme reálnou výhodnost nákupu.
          </p>
        </div>
        <div className="adapterBadge">
          <span className="dot" />
          ABOUT YOU CZ · Muži
        </div>
      </header>

      <section className="panel controlPanel">
        <div>
          <h2>Scan + endpoint discovery</h2>
          <p>
            Otevře aktuální český storefront v lokálním Chromiu, sbírá viditelné produkty a současně hledá bulk JSON endpoint pro celý katalog.
          </p>
        </div>
        <button onClick={startDiscovery} disabled={status.running || starting}>
          {status.running ? "Scan běží…" : starting ? "Spouštím…" : "Spustit scan"}
        </button>
      </section>

      <section className="stats">
        <article className="stat"><span>Fáze</span><strong>{status.phase}</strong></article>
        <article className="stat"><span>Product links</span><strong>{status.productLinks.toLocaleString("cs-CZ")}</strong></article>
        <article className="stat"><span>Vyhodnocené dealy</span><strong>{products.length.toLocaleString("cs-CZ")}</strong></article>
        <article className="stat"><span>Endpoint kandidáti</span><strong>{status.candidateResponses.toLocaleString("cs-CZ")}</strong></article>
      </section>

      <section className="panel progressPanel">
        <div className="progressTop"><span>Průchod katalogem</span><strong>{progress} %</strong></div>
        <div className="progressTrack"><div className="progressValue" style={{ width: `${progress}%` }} /></div>
        <p className="muted">Run: {status.runId ?? "zatím žádný"}</p>
        {status.error ? <p className="error">{status.error}</p> : null}
      </section>

      <section className="panel">
        <div className="sectionHeading">
          <div>
            <h2>Nejlepší nákupní kandidáti právě teď</h2>
            <p>
              Řazení vychází z aktuální ceny vůči deklarovanému 30dennímu minimu. Nízká cena není automaticky známka kvality produktu — materiálové a značkové enrichment přidáme až nad shortlistem.
            </p>
          </div>
        </div>

        {products.length === 0 ? (
          <div className="empty">Spusť scan. Jakmile načteme produktové karty, objeví se tu první dnešní dealy.</div>
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
                {products.slice(0, 40).map((product) => (
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
            <h2>Nejlepší endpoint kandidáti</h2>
            <p>Vyšší score = větší šance, že response obsahuje produkty, ceny, varianty nebo pagination.</p>
          </div>
        </div>

        {candidates.length === 0 ? (
          <div className="empty">Scan zároveň analyzuje síť. Tady se objeví zachycené JSON endpointy.</div>
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
