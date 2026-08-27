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

export default function Home() {
  const [status, setStatus] = useState<Status>(emptyStatus);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    const [statusResponse, candidatesResponse] = await Promise.all([
      fetch("/api/discovery/status", { cache: "no-store" }),
      fetch("/api/candidates", { cache: "no-store" }),
    ]);

    if (statusResponse.ok) setStatus(await statusResponse.json());
    if (candidatesResponse.ok) {
      const payload = await candidatesResponse.json();
      setCandidates(payload.candidates ?? []);
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
            Nejdřív najdeme stabilní datový zdroj. Teprve potom škálujeme katalog a stavíme cenovou historii.
          </p>
        </div>
        <div className="adapterBadge">
          <span className="dot" />
          ABOUT YOU CZ · Muži
        </div>
      </header>

      <section className="panel controlPanel">
        <div>
          <h2>Endpoint discovery</h2>
          <p>
            Otevře aktuální český storefront v lokálním Chromiu, sleduje JSON komunikaci a hledá bulk produktový endpoint.
          </p>
        </div>
        <button onClick={startDiscovery} disabled={status.running || starting}>
          {status.running ? "Discovery běží…" : starting ? "Spouštím…" : "Spustit discovery"}
        </button>
      </section>

      <section className="stats">
        <article className="stat"><span>Fáze</span><strong>{status.phase}</strong></article>
        <article className="stat"><span>Product links</span><strong>{status.productLinks.toLocaleString("cs-CZ")}</strong></article>
        <article className="stat"><span>JSON responses</span><strong>{status.jsonResponses.toLocaleString("cs-CZ")}</strong></article>
        <article className="stat"><span>Kandidáti</span><strong>{status.candidateResponses.toLocaleString("cs-CZ")}</strong></article>
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
            <h2>Nejlepší endpoint kandidáti</h2>
            <p>Vyšší score = větší šance, že response obsahuje produkty, ceny, varianty nebo pagination.</p>
          </div>
        </div>

        {candidates.length === 0 ? (
          <div className="empty">Spusť discovery. Tady se objeví zachycené JSON endpointy.</div>
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
        Data discovery je oddělené od core enginu. Další e-shop = nový adapter, ne přepis aplikace.
      </footer>
    </main>
  );
}
