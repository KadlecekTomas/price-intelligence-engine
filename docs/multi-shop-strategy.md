# Multi-shop price intelligence strategy

The engine deliberately separates shop integrations by what we can actually verify.

## Tier A — verified full catalog

Use this only when the public storefront exposes a trustworthy catalog total and the crawler can prove near-complete coverage before atomic publication.

Current shop:
- ABOUT YOU CZ — partitioned full catalog, coverage-gated publication, scheduled price refresh.

## Tier B — on-demand market + watchlist tracking

Use this for large or restrictive shops where crawling every PDP would be wasteful or unreliable. Search public storefront surfaces for an exact product, verify candidate PDPs, and persist/watch only products users actually care about.

Current states:
- ABOUT YOU CZ — active.
- Footshop CZ — partial: sitemap discovery works, PDP verification may be blocked.
- Queens CZ — partial: sitemap discovery works, PDP verification may be blocked.
- Sizeer CZ — candidate provider implemented; live smoke decides promotion to active.
- Zalando CZ — candidate: public pages exist, but GitHub-runner automated search currently returns HTTP 403. We do not bypass that restriction and assert no price.
- eobuv.cz — candidate.
- Answear CZ — candidate.
- Buzz Sneakers CZ — candidate.

## Rules

- Never claim a shop is active until a repeatable live smoke gate passes.
- Never bypass authentication, CAPTCHA, robots restrictions, rate limits, or access controls.
- Do not full-crawl a shop merely because product URLs are discoverable.
- Prefer watchlist refresh for large catalogs; only price changes should create history rows.
- Provider failures must degrade independently and must not break results from healthy shops.
- Candidate providers are never included in market aggregation.
