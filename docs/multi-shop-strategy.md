# Multi-shop price intelligence strategy

The engine deliberately separates shops into two integration tiers.

## Tier A — verified full catalog

Use this only when the public storefront exposes a trustworthy catalog total and the crawler can prove near-complete coverage before atomic publication.

Current shop:
- ABOUT YOU CZ — partitioned full catalog, coverage-gated publication, scheduled price refresh.

## Tier B — on-demand market + watchlist tracking

Use this for large or restrictive shops where crawling every PDP would be wasteful or unreliable. Search the public storefront for an exact product, verify candidate PDPs, and persist/watch only products users actually care about.

Current active shops:
- Zalando CZ — public `/katalog/?q=` search + PDP verification.
- Footshop CZ — public product sitemap + PDP verification when allowed.
- Queens CZ — public product sitemap + PDP verification when allowed.

Next candidates after live transport gates:
- Sizeer CZ
- eobuv.cz
- Answear CZ
- Buzz Sneakers CZ

## Rules

- Never claim a shop is active until a live smoke gate passes.
- Never bypass authentication, CAPTCHA, robots restrictions, or access controls.
- Do not full-crawl a shop merely because product URLs are discoverable.
- Prefer watchlist refresh for large catalogs; only price changes should create history rows.
- Provider failures must degrade independently and must not break results from healthy shops.
