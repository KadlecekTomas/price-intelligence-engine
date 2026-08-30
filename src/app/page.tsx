"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

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
  liveFetchedAt?: string | null;
  warnings?: string[];
};

type Filters = {
  category: string;
  color: string;
  size: string;
  maxPrice: string;
  material: string;
  sort: Intent["sort"];
  quality: boolean;
};

type HistoryMode = "push" | "replace" | "none";

const EMPTY_FILTERS: Filters = {
  category: "",
  color: "",
  size: "",
  maxPrice: "",
  material: "",
  sort: "recommended",
  quality: false,
};

const EXAMPLES = [
  "černé tričko L do 1 500 Kč, bavlna, top deal",
  "kvalitní mikina do 2 tisíc bez polyesteru",
  "Nike bílé tenisky velikost 43",
];

const CATEGORY_OPTIONS = [
  ["", "Všechny kategorie"],
  ["tričko", "Trička"],
  ["mikina", "Mikiny"],
  ["svetr", "Svetry"],
  ["košile", "Košile"],
  ["džíny", "Džíny"],
  ["kalhoty", "Kalhoty"],
  ["bunda", "Bundy"],
  ["kabát", "Kabáty"],
  ["kraťasy", "Kraťasy"],
  ["polo", "Polo"],
  ["tenisky", "Tenisky"],
  ["boty", "Boty"],
] as const;

const COLOR_OPTIONS = [
  ["", "Jakákoli barva"],
  ["černá", "Černá"],
  ["bílá", "Bílá"],
  ["modrá", "Modrá"],
  ["šedá", "Šedá"],
  ["zelená", "Zelená"],
  ["béžová", "Béžová"],
  ["hnědá", "Hnědá"],
  ["červená", "Červená"],
] as const;

const MATERIAL_OPTIONS = [
  ["", "Jakýkoli materiál"],
  ["bavlna", "Bavlna"],
  ["vlna", "Vlna"],
  ["merino", "Merino"],
  ["len", "Len"],
  ["kašmír", "Kašmír"],
  ["kůže", "Kůže"],
  ["lyocell", "Lyocell / Tencel"],
  ["modal", "Modal"],
] as const;

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
  if (data.source === "hybrid") return "index + ABOUT YOU live";
  if (data.source === "postgres") return "uložený index";
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

function filtersFromUrl(params: URLSearchParams): Filters {
  const sort = params.get("sort");
  return {
    category: params.get("category") ?? "",
    color: params.get("color") ?? "",
    size: params.get("size") ?? "",
    maxPrice: params.get("maxPrice") ?? "",
    material: params.get("material") ?? "",
    sort: sort === "price" || sort === "history" || sort === "deal" ? sort : "recommended",
    quality: params.get("quality") === "1" || params.get("quality") === "true",
  };
}

function searchParams(query: string, filters: Filters) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (filters.category) params.set("category", filters.category);
  if (filters.color) params.set("color", filters.color);
  if (filters.size.trim()) params.set("size", filters.size.trim());
  if (filters.maxPrice.trim()) params.set("maxPrice", filters.maxPrice.trim());
  if (filters.material) params.set("material", filters.material);
  if (filters.sort !== "recommended") params.set("sort", filters.sort);
  if (filters.quality) params.set("quality", "1");
  params.set("limit", "36");
  return params;
}

function pageUrl(params: URLSearchParams) {
  const visible = new URLSearchParams(params);
  visible.delete("limit");
  const query = visible.toString();
  return query ? `/?${query}` : "/";
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastCompletedAt, setLastCompletedAt] = useState<Date | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);

  const search = useCallback(async (
    nextQuery: string,
    nextFilters: Filters,
    historyMode: HistoryMode = "push",
  ) => {
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    requestRef.current?.abort();

    const controller = new AbortController();
    requestRef.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15_000);

    const params = searchParams(nextQuery, nextFilters);
    if (historyMode !== "none") {
      const method = historyMode === "replace" ? "replaceState" : "pushState";
      window.history[method]({}, "", pageUrl(params));
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/search?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Vyhledávání selhalo (${response.status})`);
      const nextData = await response.json() as SearchResponse;
      if (sequence !== sequenceRef.current) return;
      setData(nextData);
      setLastCompletedAt(new Date());
    } catch (searchError) {
      if (sequence !== sequenceRef.current) return;
      if (controller.signal.aborted && !timedOut) return;
      setError(
        timedOut
          ? "Vyhledávání trvalo příliš dlouho. Zkus to znovu — předchozí request jsme bezpečně ukončili."
          : searchError instanceof Error ? searchError.message : "Vyhledávání selhalo",
      );
    } finally {
      window.clearTimeout(timeout);
      if (sequence === sequenceRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialParams = new URLSearchParams(window.location.search);
    const initialQuery = initialParams.get("q") ?? "";
    const initialFilters = filtersFromUrl(initialParams);
    setQuery(initialQuery);
    setFilters(initialFilters);
    void search(initialQuery, initialFilters, "replace");

    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const nextQuery = params.get("q") ?? "";
      const nextFilters = filtersFromUrl(params);
      setQuery(nextQuery);
      setFilters(nextFilters);
      void search(nextQuery, nextFilters, "none");
    };

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      requestRef.current?.abort();
    };
  }, [search]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search(query.trim(), filters);
  }

  function useExample(example: string) {
    setQuery(example);
    setFilters(EMPTY_FILTERS);
    void search(example, EMPTY_FILTERS);
  }

  function reset() {
    setQuery("");
    setFilters(EMPTY_FILTERS);
    void search("", EMPTY_FILTERS);
  }

  const chips = intentChips(data?.intent ?? null);
  const showingNearMatches = Boolean(
    !loading && data && data.results.length === 0 && (data.nearMatches?.length ?? 0) > 0,
  );
  const displayResults = showingNearMatches ? (data?.nearMatches ?? []) : (data?.results ?? []);
  const resultCount = data?.resultCount ?? 0;
  const candidateCount = data?.scannedProducts ?? 0;
  const persistedCount = data?.persistedProducts ?? 0;
  const liveCount = data?.liveProducts ?? 0;
  const initialLoading = loading && data === null;

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
          <h1>Najdi kus, který se fakt vyplatí.</h1>
          <p>
            Volný text je rychlý, ale produkční filtry níže mají vždy přednost. Díky tomu přesně víš,
            co engine hledá a proč konkrétní produkt doporučuje.
          </p>
        </div>

        <form className="searchBox" onSubmit={submit}>
          <label htmlFor="shopping-query">Co dnes hledáš?</label>
          <div className="searchRow">
            <input
              id="shopping-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Např. Nike bílé tenisky nebo kvalitní mikina bez polyesteru"
              autoComplete="off"
            />
            <button type="submit" disabled={loading}>
              {loading ? "Aktualizuji…" : "Najít nejlepší"}
            </button>
          </div>

          <div className="filterGrid" aria-label="Přesné filtry">
            <label>
              <span>Kategorie</span>
              <select
                value={filters.category}
                onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}
              >
                {CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>Barva</span>
              <select
                value={filters.color}
                onChange={(event) => setFilters((current) => ({ ...current, color: event.target.value }))}
              >
                {COLOR_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>Velikost</span>
              <input
                value={filters.size}
                onChange={(event) => setFilters((current) => ({ ...current, size: event.target.value }))}
                placeholder="L / 43,5 / W32/L32"
                autoComplete="off"
              />
            </label>
            <label>
              <span>Max. cena</span>
              <div className="priceInput">
                <input
                  inputMode="numeric"
                  value={filters.maxPrice}
                  onChange={(event) => setFilters((current) => ({
                    ...current,
                    maxPrice: event.target.value.replace(/[^0-9]/g, "").slice(0, 7),
                  }))}
                  placeholder="2000"
                />
                <em>Kč</em>
              </div>
            </label>
            <label>
              <span>Materiál</span>
              <select
                value={filters.material}
                onChange={(event) => setFilters((current) => ({ ...current, material: event.target.value }))}
              >
                {MATERIAL_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>Řazení</span>
              <select
                value={filters.sort}
                onChange={(event) => setFilters((current) => ({
                  ...current,
                  sort: event.target.value as Filters["sort"],
                }))}
              >
                <option value="recommended">Doporučené</option>
                <option value="deal">Nejlepší deal</option>
                <option value="price">Nejlevnější</option>
                <option value="history">Nejblíž našemu minimu</option>
              </select>
            </label>
          </div>

          <div className="searchTools">
            <label className="qualityToggle">
              <input
                type="checkbox"
                checked={filters.quality}
                onChange={(event) => setFilters((current) => ({ ...current, quality: event.target.checked }))}
              />
              <span>Upřednostnit kvalitu materiálu</span>
            </label>
            <button className="resetButton" type="button" onClick={reset}>Vyčistit hledání</button>
          </div>

          <div className="examples">
            <span>Rychlé příklady:</span>
            {EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => useExample(example)}>
                {example}
              </button>
            ))}
          </div>
        </form>
      </header>

      <section className="searchMeta" aria-live="polite">
        <div>
          <span className="metaLabel">Engine hledá jako</span>
          <div className="intentChips">
            {chips.length > 0 ? chips.map((chip) => <span key={chip}>{chip}</span>) : <span>nejlepší aktuální dealy</span>}
          </div>
        </div>
        <div className="dataStatus">
          <strong>{resultCount}</strong>
          <span>{countLabel(resultCount, "výsledek", "výsledky", "výsledků")}</span>
          <i />
          <strong>{candidateCount}</strong>
          <span>{countLabel(candidateCount, "kandidát", "kandidáti", "kandidátů")}</span>
          <i />
          <span>{sourceLabel(data)}</span>
          {loading && data ? <b className="refreshingDot">obnovuji</b> : null}
        </div>
      </section>

      <section className="coverageStrip">
        <div><span>Uložený index</span><strong>{persistedCount.toLocaleString("cs-CZ")}</strong></div>
        <div><span>Live doplnění</span><strong>{liveCount.toLocaleString("cs-CZ")}</strong></div>
        <div>
          <span>Poslední hledání</span>
          <strong>{lastCompletedAt ? lastCompletedAt.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</strong>
        </div>
        <p>
          Dokud neběží full-catalog synchronizace, číslo kandidátů je skutečné pokrytí tohoto dotazu — ne marketingové tvrzení o celém e-shopu.
        </p>
      </section>

      {error ? (
        <div className="searchError" role="alert">
          <div>
            <strong>Vyhledávání se nepovedlo.</strong>
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => void search(query.trim(), filters, "none")}>Zkusit znovu</button>
        </div>
      ) : null}

      {!loading && data?.warnings && data.warnings.length > 0 ? (
        <section className="searchWarnings">
          {data.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </section>
      ) : null}

      {!loading && data?.scannedProducts === 0 ? (
        <section className="emptyCatalog">
          <p className="eyebrow">DATA NEJSOU DOSTUPNÁ</p>
          <h2>Vyhledávání teď nemá z čeho bezpečně vybírat.</h2>
          <p>
            Nevracíme vymyšlené výsledky. Zkus hledání znovu; jakmile je dostupný uložený index nebo live storefront,
            výsledky se objeví automaticky.
          </p>
        </section>
      ) : null}

      {showingNearMatches ? (
        <section className="emptyResults">
          <h2>Přesná shoda se nenašla — tady jsou nejbližší možnosti.</h2>
          <p>
            U každé karty uvádíme, co přesně nesedí nebo co je potřeba ověřit. Near-match nikdy nevydáváme za přesnou shodu.
          </p>
        </section>
      ) : null}

      <section className="resultsGrid" aria-busy={loading}>
        {initialLoading
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
                    <div><span>30denní reference</span><strong>{money(product.lowest30dCzk)}</strong></div>
                    <div><span>Naše minimum</span><strong>{money(product.observedMinCzk)}</strong></div>
                    <div><span>Deal score</span><strong>{product.dealScore == null ? "—" : Math.round(product.dealScore)}</strong></div>
                    <div><span>Buy score</span><strong>{product.buyScore == null ? "—" : Math.round(product.buyScore)}</strong></div>
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
          <p>Zkus ubrat jednu podmínku nebo vyčistit přesný filtr. Engine raději vrátí nulu než produkt, který zadání nesplňuje.</p>
        </section>
      ) : null}

      <footer className="shoppingFooter">
        <strong>Price Intelligence Engine</strong>
        <span>ABOUT YOU je první adapter. Stejný search kontrakt použijeme pro další české e-shopy.</span>
      </footer>
    </main>
  );
}
