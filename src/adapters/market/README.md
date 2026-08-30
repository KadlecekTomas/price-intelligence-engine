# Market providers

Provider state is owned by `src/adapters/shop-registry.ts`.

Current CZ sources:
- ABOUT YOU — active, coverage-gated full-catalog foundation.
- Footshop — partial, product sitemap discovery with PDP verification when allowed.
- Queens — partial, product sitemap discovery with PDP verification when allowed.
- Sizeer — candidate with public collection + PDP implementation; requires live smoke success before aggregation.
- Zalando — candidate because the GitHub-runner live gate receives HTTP 403; not included in aggregation.

A source must fail independently: one blocked or unavailable shop must never suppress healthy offers from other providers. Candidate sources never assert prices.
