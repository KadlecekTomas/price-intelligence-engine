"use client";

export type MarketIntentView = {
  exactProduct: boolean;
  brand: string | null;
  model: string | null;
  size: string | null;
  sort: "cheapest" | "recommended";
  canonicalKey: string | null;
};

export type MarketOfferView = {
  id: string;
  shopId: string;
  shopName: string;
  url: string;
  title: string;
  brand: string | null;
  model: string | null;
  sku: string | null;
  gtin: string | null;
  color: string | null;
  priceCzk: number;
  shippingCzk: number | null;
  totalPriceCzk: number;
  currency: "CZK";
  availability: "in_stock" | "out_of_stock" | "unknown";
  sizes: string[];
  requestedSizeStatus: "available" | "unavailable" | "unknown";
  matchScore: number;
  checkedAt: string;
};

export type MarketSourceView = {
  shopId: string;
  shopName: string;
  status: "ok" | "partial" | "failed";
  verification: "live" | "catalog-only" | "blocked";
  catalogCount: number;
  matchedCount: number;
  checkedCount: number;
  offerCount: number;
  durationMs: number;
  warning: string | null;
};

export type MarketPayloadView = {
  offers: MarketOfferView[];
  sources: MarketSourceView[];
  checkedAt: string;
  warnings: string[];
};

type Props = {
  intent: MarketIntentView;
  market: MarketPayloadView;
  loading: boolean;
};

function money(value: number | null | undefined) {
  return value == null ? "—" : `${value.toLocaleString("cs-CZ")} Kč`;
}

function shopStatus(source: MarketSourceView) {
  if (source.status === "failed") return "zdroj nedostupný";
  if (source.verification === "blocked") {
    return source.matchedCount > 0
      ? `${source.matchedCount} shod v katalogu · cenu nelze serverově ověřit`
      : "katalog načten · cenové ověření není dostupné";
  }
  if (source.offerCount > 0) {
    return `${source.offerCount} ${source.offerCount === 1 ? "cenově ověřená nabídka" : "cenově ověřené nabídky"}`;
  }
  if (source.matchedCount > 0) {
    return `${source.matchedCount} shod v načteném katalogu · bez potvrzené nabídky`;
  }
  return "model v načteném katalogu nenalezen";
}

function sizeLabel(offer: MarketOfferView, requestedSize: string | null) {
  if (!requestedSize) return offer.sizes.length > 0 ? `${offer.sizes.length} velikostí` : "velikosti ověřit";
  if (offer.requestedSizeStatus === "available") return `velikost ${requestedSize} skladem`;
  if (offer.requestedSizeStatus === "unavailable") return `velikost ${requestedSize} není skladem`;
  return `velikost ${requestedSize} ověřit`;
}

export default function MarketResults({ intent, market, loading }: Props) {
  const catalogCount = market.sources.reduce((sum, source) => sum + source.catalogCount, 0);
  const liveSources = market.sources.filter((source) => source.verification === "live").length;
  const matchedCount = market.sources.reduce((sum, source) => sum + source.matchedCount, 0);
  const bestOffer = market.offers[0] ?? null;
  const productLabel = [intent.brand, intent.model].filter(Boolean).join(" ");

  return (
    <section className="marketMode" aria-busy={loading}>
      <div className="marketIntro">
        <div>
          <p className="eyebrow">MARKET SEARCH</p>
          <h2>{productLabel || "Konkrétní produkt"}</h2>
          <p>
            Procházíme připojené katalogové zdroje, oddělujeme pouhou katalogovou shodu od skutečně
            ověřené ceny a staré vyprodané stránky nevydáváme za živou nabídku.
          </p>
        </div>
        <div className="marketHeadlineStats">
          <div><strong>{catalogCount.toLocaleString("cs-CZ")}</strong><span>položek v načtených zdrojích</span></div>
          <div><strong>{matchedCount}</strong><span>shod modelu</span></div>
          <div><strong>{liveSources}/{market.sources.length}</strong><span>cenově ověřitelných zdrojů</span></div>
        </div>
      </div>

      <div className="marketSources" aria-label="Prohledané obchody">
        {market.sources.map((source) => (
          <article className={`marketSource marketSource-${source.status}`} key={source.shopId}>
            <div>
              <strong>{source.shopName}</strong>
              <span>
                {source.catalogCount.toLocaleString("cs-CZ")} načtených položek · {source.matchedCount} shod · {source.checkedCount} ověřených detailů
              </span>
            </div>
            <p>{shopStatus(source)}</p>
          </article>
        ))}
      </div>

      {bestOffer ? (
        <div className="marketBest">
          <span>NEJLEVNĚJŠÍ Z OVĚŘENÝCH NABÍDEK</span>
          <strong>{money(bestOffer.priceCzk)}</strong>
          <p>{bestOffer.shopName} · {sizeLabel(bestOffer, intent.size)}</p>
        </div>
      ) : matchedCount > 0 ? (
        <div className="marketEmpty">
          <p className="eyebrow">MODEL V KATALOGU NALEZEN</p>
          <h3>Máme katalogové shody, ale žádný připojený zdroj nám teď nepotvrdil cenu jako živou nabídku.</h3>
          <p>
            Nehážeme sem cenu z vyhledávače ani ze staré stránky. Jakmile máme veřejný feed, čitelný listing
            nebo jiný spolehlivý zdroj ceny, nabídka se zařadí automaticky.
          </p>
        </div>
      ) : (
        <div className="marketEmpty">
          <p className="eyebrow">AKTUÁLNĚ BEZ POTVRZENÉ SHODY</p>
          <h3>V právě připojených katalogových zdrojích jsme tenhle model nenašli.</h3>
          <p>
            To neznamená, že produkt nikde na českém trhu neexistuje. Znamená to jen, že ho zatím nepotvrdily
            zdroje, které máme v tomto market režimu připojené.
          </p>
        </div>
      )}

      {market.offers.length > 0 ? (
        <div className="marketOfferList">
          {market.offers.map((offer, index) => (
            <article className={`marketOffer${index === 0 ? " marketOffer-best" : ""}`} key={offer.id}>
              <div className="marketOfferHead">
                <div>
                  <span className="marketShop">{offer.shopName}</span>
                  {index === 0 ? <b>NEJLEVNĚJŠÍ OVĚŘENÁ</b> : null}
                </div>
                <span className={`marketAvailability marketAvailability-${offer.requestedSizeStatus}`}>
                  {sizeLabel(offer, intent.size)}
                </span>
              </div>

              <h3>{offer.title}</h3>

              <div className="marketPriceRow">
                <strong>{money(offer.priceCzk)}</strong>
                <span>{offer.shippingCzk == null ? "doprava: ověřit" : `doprava ${money(offer.shippingCzk)}`}</span>
              </div>

              <div className="marketOfferMeta">
                {offer.color ? <span>{offer.color}</span> : null}
                {offer.sku ? <span>SKU {offer.sku}</span> : null}
                {offer.gtin ? <span>GTIN {offer.gtin}</span> : null}
                <span>shoda {Math.round(offer.matchScore)} %</span>
              </div>

              <div className="marketOfferFoot">
                <span>ověřeno {new Date(offer.checkedAt).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</span>
                <a href={offer.url} target="_blank" rel="noreferrer">
                  Otevřít v {offer.shopName} ↗
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
