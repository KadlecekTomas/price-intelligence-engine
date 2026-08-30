# Shop registry

`shop-registry.ts` is the single source of truth for which stores are actually active.

- `active` means a provider exists and is allowed into market aggregation.
- `candidate` means the public storefront looks usable, but a repeatable transport/live verification gate has not passed yet.
- `fullCatalog: true` is reserved for sources with coverage-gated atomic publication.

Do not promote a candidate by changing only its label. Add a provider, add deterministic parser tests, add a live smoke gate, and only then mark it active.
