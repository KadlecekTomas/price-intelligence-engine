# Price Intelligence Engine

Lokální **multi-shop price-intelligence platforma pro české e-shopy**. Core není navázaný na jediný obchod; každý storefront dostává vlastní adapter a převádí data do společného modelu.

## Proč to stavíme

Marketingová sleva není totéž jako dobrá cena. Engine má ukládat cenovou historii, varianty a dostupnost a hodnotit nabídku vůči vlastnímu historickému minimu. Později přidáme párování stejného produktu napříč obchody.

## První adapter

**ABOUT YOU CZ / Muži** (`aboutyou.cz`). První milestone není UI katalogu, ale nalezení stabilního bulk datového zdroje současného českého storefrontu. Nechceme otevírat desetitisíce PDP stránek jeden po druhém.

## Aktuální MVP

Lokální Next.js aplikace umí:

- spustit Playwright Chromium proti českému pánskému katalogu ABOUT YOU,
- zachytávat aktuální JSON komunikaci webu,
- skórovat endpointy podle signálů `products / prices / variants / stock / pagination`,
- ukládat zachycené response samples lokálně do `data/runs/`,
- zobrazovat progress a nejlepší kandidáty v lokálním dashboardu,
- držet deal-scoring jako samostatný domain modul připravený pro další shopy.

Discovery používá standardní veřejný storefront; není postavené na obcházení autentizace nebo anti-bot mechanismů.

## Spuštění

Požadavek: Node.js 22.

```bash
npm install
npx playwright install chromium
npm run dev
```

Potom otevři `http://localhost:3000` a klikni na **Spustit discovery**. Defaultně se otevře viditelné Chromium, abychom přesně viděli, co web dělá. Pro headless režim nastav `PLAYWRIGHT_HEADLESS=1`.

## Architektura

```text
src/
  adapters/        # shop-specific discovery / mapping
  domain/          # společný datový model + deal score
  lib/             # orchestrace discovery
  app/             # lokální dashboard + API

data/runs/         # lokální capture, ignorovaný Gitem
```

Další e-shop znamená nový adapter, ne fork aplikace.

## Další krok

1. Spustit ABOUT YOU CZ discovery na lokálním stroji.
2. Identifikovat bulk PLP endpoint + pagination/cursor.
3. Implementovat přímý, rate-limited katalogový sync přes adapter.
4. Doplnit stabilní product/variant IDs, ceny, velikosti a stock.
5. Připojit PostgreSQL a ukládat price snapshots.
6. Až potom přidat druhý český e-shop a otestovat cross-shop model.
