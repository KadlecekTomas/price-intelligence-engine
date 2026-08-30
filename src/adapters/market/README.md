# Market providers

Active providers are registered through `src/adapters/shop-registry.ts`.

Current active CZ sources:
- ABOUT YOU — public catalog listing adapter.
- Zalando — public catalog search + PDP verification.
- Footshop — product sitemap + PDP verification.
- Queens — product sitemap + PDP verification.

A source must fail independently: one blocked or unavailable shop must never suppress healthy offers from other providers.
