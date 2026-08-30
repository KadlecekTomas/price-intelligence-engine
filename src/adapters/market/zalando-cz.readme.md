# Zalando CZ provider boundary

The Zalando provider intentionally uses only public storefront HTML:

1. `https://www.zalando.cz/katalog/?q=<exact product>` for candidate discovery.
2. Public product detail pages for price/availability verification.

It does not call or reverse-engineer internal Zalando API endpoints. If the public PDP cannot be verified, the provider returns no asserted price rather than falling back to an unverified listing value.
