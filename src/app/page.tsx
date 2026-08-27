"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Product = {
  id: string;
  url: string;
  text: string;
  currentPriceCzk: number;
  originalPriceCzk: number | null;
  lowest30dCzk: number | null;
  dealScore: number | null;
  material: string | null;
  fit: string | null;
  color: string | null;
  materialScore: number | null;
  buyScore: number | null;
  observedMinCzk?: number | null;
  observationCount?: number;
  historyScore?: number | null;
};

type Intent = {
  category: string | null;
  color: string | null;
  size: string | null;
  maxPriceCzk: number | null;
  materials: string[];
  excludedMaterials: string[];
  excludedTerms: string[];
  requiredTerms: string[];
  qualityPreferred: boolean;
  sort: "recommended" | "price" | "history" | "deal";
};

type Result = {
  product: Product;
  searchScore: number;
  recommendation: "BUY_NOW" | "GOOD" | "WAIT" | "FAKE_SALE" | "CHECK";
  reasons: string[];
};

type SearchResponse = {
  query: string;
  intent: Intent;
  results: Result[];
  nearMatches?: Result[];
  source: "postgres" | "memory" | "live-aboutyou" | "hybrid";
  scannedProducts: number;
  persistedProducts?: number;
  liveProducts?: number;
  liveBatches?: number;
  resultCount: number;
  nearMatchCount?: number;
  warnings?: string[];
};

const EXAMPLES = [
  "černé tričko L do 1 500 Kč, bavlna, top deal",
  "černé tričko L do 500 Kč, bez límečku",
  "kvalitní mikina do 2 tisíc bez polyesteru",
  "Nike bílé tenisky velikost 43",
];

const RECOMMENDATIONS: Record<Result["recommendation"], { label: string; className: string }> = {
  BUY_NOW: { label: "KUP TEĎ", className: "buyNow" },
  GOOD: { label: "DOBRÁ CENA", className: "good" },
  WAIT: { label: "POČKEJ", className: "wait" },
  FAKE_SALE: { label: "FALEŠNÁ SLEVA", className: "fake" },
  CHECK: { label: "PROVĚŘIT", className: "check" },
};

const NEGATIVE_DISPLAY_FORMS: Record<string, string> = {
  "límeček": "límečku",
  logo: "loga",
  potisk: "potisku",
  kapuce: "kapuce",
  zip: "zipu",
};

function money(value: number | null | undefined) {
  return value == null ? "—" : `${value.toLocaleString("cs-CZ")} Kč`;
}

function productName(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+(?:Původně:|Poslední nejnižší cena:).*$/i, "")
    .replace(/\s+[0-9][0-9\s.]*\s*Kč.*$/i, "")
    .replace(/^(?:(?:DEAL|VÝPRODEJ|OSOBNÍ KUPÓN|NOVÉ|EXKLUZIVNĚ|PRÉMIUM)\s+)+/i, "")
    .trim()
    .slice(0, 125) || "Produkt";
}

function sourceLabel(data: SearchResponse | null) {
  if (!data) return "načítám";
  if (data.source === "live-aboutyou") return "ABOUT YOU live";
  if (data.source === "hybrid") return "Supabase + ABOUT YOU live";
  if (data.source === "postgres") return "Supabase";
  return "lokální data";
}

function countLabel(value: number, one: string, few: string, many: string) {
  const absolute = Math.abs(value);
  if (absolute === 1) return one;
  if (absolute >= 2 && absolute <= 4) return few;
  return many;
}

function negativeTermLabel(term: string) {
  return `bez ${NEGATIVE_DISPLAY_FORMS[term] ?? term}`;
}

function intentChips(intent: Intent | null) {
  if (!intent) return [];
  return [
    intent.category,
    intent.color,
    intent.size ? `velikost ${intent.size}` : null,
    intent.maxPriceCzk ? `do ${money(intent.maxPriceCzk)}` : null,
    ...intent.materials,
    ...intent.excludedMaterials.map((material) => `bez ${material}`),
    ...intent.excludedTerms.map(negativeTermLabel),
    ...intent.requiredTerms,
    intent.qualityPreferred ? "priorita kvalita" : null,
    intent.sort === "history" ? "řadit podle historie" : null,
    intent.sort === "price" ? "nejlevnější" : null,
    intent.sort === "deal" ? "nejlepší deal" : null,
  ].filter((item): item is string => Boolean(item));
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (nextQuery: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(nextQuery)}&limit=36`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Vyhledávání selhalo (${response.status})`);
      setData(await response.json());
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Vyhledávání selhalo");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void search("");
  }, [search]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search(query.trim());
  }

  function useExample(example: string) {
    setQuery(example);
    void search(example);
  }

  const chips = intentChips(data?.intent ?? null);
  const showingNearMatches = Boolean(
    !loading && data && data.results.length === 0 && (data.nearMatches?.length ?? 0) > 0,
  );
  const displayResults = showingNearMatches ? (data?.nearMatches ?? []) : (data?.results ?? []);
  const resultCount = data?.resultCount ?? 0;
  const candidateCount = data?.scannedProducts ?? 0;
  const batchCount = data?.liveBatches ?? 0;

  return (
    <main className="shoppingShell">
      <header className="shoppingHero">
        <nav className="topbar">
          <div className="brandMark">PI</div>
          <div className="brandCopy">
            <strong>Price Intelligence</strong>
            <span>CZ fashion deals</span>
          </div>
          <div className="shopStatus"><span /> ABOUT YOU CZ · první zdroj</div>
        </nav>

        <div className="heroCopy">
          <p className="eyebrow">CENA × HISTORIE × MATERIÁL</p>
          <h1>Napiš, co chceš koupit.</h1>
          <p>
            Nehledáme největší procento slevy. Hledáme kusy, které dávají smysl vůči
            aktuální ceně, 30dennímu minimu, naší vlastní historii a materiálu.
          </p>
        </div>

        <form className="searchBox" onSubmit={submit}>
          <label htmlFor="shopping-query">Co dnes hledáš?</label>
          <div className="searchRow">
            <input
              id="shopping-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Např. černé tričko L do 500 Kč, bez límečku"
              autoComplete="off"
            />
            <button type="submit" disabled={loading}>
              {loading ? "Hledám…" : "Najít nejlepší"}
            </button>
          </div>
          <div className="examples">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => useExample(example)}>
                {example}
              </button>
            ))}
          </div>
        </form>
      </header>

      <section className="searchMeta">
        <div>
          <span className="metaLabel">Rozumím tomu jako</span>
          <div className="intentChips">
            {chips.length > 0 ? chips.map((chip) => <span key={chip}>{chip}</span>) : <span>nejlepší aktuální dealy</span>}
          </div>
        </div>
        <div className="dataStatus">
          <strong>{resultCount}</strong>
          <span>{countLabel(resultCount, "přesný výsledek", "přesné výsledky", "přesných výsledků")}</span>
          <i />
          <strong>{candidateCount}</strong>
          <span>{countLabel(candidateCount, "unikátní kandidát", "unikátní kandidáti", "unikátních kandidátů")}</span>
          {batchCount > 0 ? (
            <>
              <i />
              <strong>{batchCount}</strong>
              <span>{countLabel(batchCount, "live výřez", "live výřezy", "live výřezů")}</span>
            </>
          ) : null}
          <i />
          <span>{sourceLabel(data)}</span>
        </div>
      </section>

      {error ? <div className="searchError">{error}</div> : null}

      {!loading && data?.warnings && data.warnings.length > 0 ? (
        <section className="searchWarnings">
          {data.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </section>
      ) : null}

      {!loading && data?.scannedProducts === 0 ? (
        <section className="emptyCatalog">
          <p className="eyebrow">LIVE DATA NEJSOU DOSTUPNÁ</p>
          <h2>Vyhledávání teď nemá z čeho vybírat.</h2>
          <p>
            Zkus dotaz znovu za chvíli. Jakmile máme uložený katalog v Supabase, web ho kombinuje s čerstvým ABOUT YOU live výřezem.
          </p>
        </section>
      ) : null}

      {showingNearMatches ? (
        <section className="emptyResults">
          <h2>Přesná shoda se nenašla — tady jsou nejbližší možnosti.</h2>
          <p>
            Nic neskrýváme: u každé karty níže píšeme, kterou podmínku je potřeba ověřit nebo o kolik je produkt nad rozpočtem.
          </p>
        </section>
      ) : null}

      <section className="resultsGrid" aria-busy={loading}>
        {loading
          ? Array.from({ length: 8 }).map((_, index) => <article className="productCard skeleton" key={index} />)
          : displayResults.map(({ product, recommendation, reasons }) => {
              const badge = RECOMMENDATIONS[recommendation];
              return (
                <article className="productCard" key={product.id}>
                  <div className="cardTop">
                    <span className={`recommendation ${badge.className}`}>{badge.label}</span>
                    <span className="shopName">ABOUT YOU</span>
                  </div>

                  <h2>{productName(product.text)}</h2>
                  <div className="productDetails">
                    {product.color ? <span>{product.color}</span> : null}
                    {product.material ? <span>{product.material}</span> : null}
                    {product.fit ? <span>{product.fit}</span> : null}
                  </div>

                  <div className="priceBlock">
                    <strong>{money(product.currentPriceCzk)}</strong>
                    {product.originalPriceCzk && product.originalPriceCzk > product.currentPriceCzk ? (
                      <del>{money(product.originalPriceCzk)}</del>
                    ) : null}
                  </div>

                  <div className="metrics">
                    <div><span>30d minimum</span><strong>{money(product.lowest30dCzk)}</strong></div>
                    <div><span>Naše minimum</span><strong>{money(product.observedMinCzk)}</strong></div>
                    <div><span>Buy score</span><strong>{product.buyScore == null ? "—" : Math.round(product.buyScore)}</strong></div>
                    <div><span>Historie</span><strong>{product.historyScore == null ? "—" : Math.round(product.historyScore)}</strong></div>
                  </div>

                  {reasons.length > 0 ? (
                    <ul className="reasons">
                      {reasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  ) : (
                    <p className="noReason">Máme zatím málo vlastních pozorování — ber jako kandidáta k prověření.</p>
                  )}

                  <div className="cardFooter">
                    <span>{product.observationCount ? `${product.observationCount}× naše pozorování` : "live kandidát"}</span>
                    <a href={product.url} target="_blank" rel="noreferrer">Otevřít v obchodě ↗</a>
                  </div>
                </article>
              );
            })}
      </section>

      {!loading && data && data.scannedProducts > 0 && data.results.length === 0 && !showingNearMatches ? (
        <section className="emptyResults">
          <h2>Nic přesně neprošlo zadáním.</h2>
          <p>Zkus ubrat jednu podmínku. Jakmile získáme variant-level feed a širší katalogový sync, pokrytí bude ještě výrazně lepší.</p>
        </section>
      ) : null}

      <footer className="shoppingFooter">
        <strong>Price Intelligence Engine</strong>
        <span>ABOUT YOU je první adapter. Datový model je připravený pro další české e-shopy.</span>
      </footer>
    </main>
  );
}
