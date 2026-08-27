# Price Intelligence Engine

Lokální **multi-shop price-intelligence platforma pro české e-shopy**. Core není navázaný na jediný obchod; každý storefront dostává vlastní adapter a převádí data do společného modelu.

## Proč to stavíme

Marketingová sleva není totéž jako dobrá cena. Engine ukládá cenové snapshoty, později varianty a dostupnost, a hodnotí nabídku vůči historii. ABOUT YOU je první adapter, ne cílová architektura.

## První adapter

**ABOUT YOU CZ / Muži** (`aboutyou.cz`). První technický milestone je nalezení stabilního bulk datového zdroje současného českého storefrontu. Nechceme otevírat desetitisíce PDP stránek jeden po druhém.

## Co už MVP umí

- Playwright Chromium proti českému pánskému katalogu ABOUT YOU,
- robustnější extrakci ceny z okolní produktové karty,
- zachytávání aktuální JSON komunikace webu,
- scoring endpointů podle signálů `products / prices / variants / stock / pagination`,
- deal score podle ceny vůči e-shopem uváděnému 30dennímu minimu,
- cílený PDP enrichment materiálu, střihu a barvy u nejlepšího shortlistu,
- lokální capture do `data/runs/`,
- volitelný zápis do PostgreSQL přes `DATABASE_URL`,
- Vercel-safe hosted dashboard, který Playwright nespouští serverless,
- verzované Supabase schema v `supabase/migrations/`.

Discovery používá standardní veřejný storefront; není postavené na obcházení autentizace, CAPTCHA nebo anti-bot mechanismů.

## Nejrychlejší spuštění pro dnešní nákup

Požadavek: Node.js 22.

```bash
npm install
npx playwright install chromium
npm run scan
```

`npm run scan` otevře Chromium, projde aktuální ABOUT YOU CZ / Muži, vyhodnotí nalezené produkty, obohatí nejlepší oblečení o materiál a na konci:

- vypíše TOP kandidáty přímo v terminálu,
- uloží `products.json`, `candidates.json` a další capture soubory do `data/runs/<runId>/`,
- vytvoří `data/runs/<runId>/shopping-report.md`,
- pokud je nastavený `DATABASE_URL`, uloží scan i do PostgreSQL jako další bod cenové historie.

Pro dashboard místo CLI:

```bash
npm run dev
```

Pak otevři `http://localhost:3000`.

## Environment

Zkopíruj `.env.example` do `.env.local`.

```env
PLAYWRIGHT_HEADLESS=0
DATABASE_URL=
```

`DATABASE_URL` je volitelný. Bez něj funguje scanner dál čistě lokálně. S ním se snapshot zapíše do PostgreSQL/Supabase a hosted dashboard může číst stejná data.

## Architektura

```text
ABOUT YOU CZ / další shop
          │
          ▼
   shop adapter / worker
          │
          ├──── lokální capture + shopping-report.md
          │
          ▼
   PostgreSQL / Supabase
          │
          ▼
      Next.js UI
          │
          ▼
        Vercel
```

```text
src/
  adapters/        # shop-specific discovery / mapping
  cli/             # one-command lokální workflow
  domain/          # společný datový model + deal score
  lib/             # discovery + persistence
  app/             # dashboard + API
supabase/migrations/
data/runs/         # lokální capture, ignorovaný Gitem
```

Další e-shop znamená nový adapter, ne fork aplikace.

## Co následuje

1. Pustit reálný ABOUT YOU CZ scan a prohlédnout zachycené endpoint kandidáty.
2. Identifikovat bulk PLP endpoint + pagination/cursor.
3. Nahradit scrollování přímým, rate-limited katalogovým syncem.
4. Doplnit stabilní product/variant IDs, velikosti a stock.
5. Začít sbírat vlastní historická minima z `price_snapshots`.
6. Přidat druhý český e-shop a otestovat cross-shop matching.
