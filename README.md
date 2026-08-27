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
- vlastní historické minimum, maximum a počet pozorování z `price_snapshots`,
- historický score až od druhého vlastního snapshotu,
- cílený PDP enrichment materiálu, střihu a barvy u nejlepšího shortlistu,
- materiálový scoring podle typu oděvu: trička, úplety, denim, outerwear a sportswear,
- nákupní CLI filtry pro cenu, score, text, velikost a počet výsledků,
- lokální capture do `data/runs/`,
- volitelný zápis do PostgreSQL přes `DATABASE_URL`,
- Vercel-safe hosted dashboard, který Playwright nespouští serverless,
- verzované Supabase schema v `supabase/migrations/`,
- regresní testy domain scoringu v CI.

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
- pokud je nastavený `DATABASE_URL`, uloží scan do PostgreSQL a report načte i naše historické minimum a počet pozorování.

### Nákupní filtry

```bash
npm run scan -- --max-price=2000 --contains=tričko --min-buy=70 --limit=15
```

Podporované filtry:

```text
--max-price=2000      maximální cena v Kč
--min-buy=70          minimální Buy score
--min-history=80      minimální vlastní history score
--contains=tričko     hledání v produktu, materiálu, střihu a signálech
--size=L              best-effort velikost z textu produktové karty
--limit=20            počet výsledků, 1–100
```

`--size` je zatím pouze best-effort. Spolehlivou velikost + stock zapneme až po nalezení variant-level/bulk endpointu.

Nápověda:

```bash
npm run scan -- --help
```

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

## Scoring

Cenové signály držíme oddělené:

- **Deal score** vychází z aktuální ceny vůči 30dennímu minimu publikovanému e-shopem.
- **History score** vychází z našeho vlastního pozorovaného minima a aktivuje se až od 2 vlastních snapshotů.
- **Material score** je category-aware. Například 100% polyester je silný negativní signál u běžného trička, ale u sportovního funkčního kusu ho automaticky netrestáme.
- **Buy score** zatím kombinuje cenový deal a materiál. Vlastní historii zobrazujeme zvlášť, dokud nenashromáždíme dost pozorování pro spolehlivější váhování.

## Testy

```bash
npm test
npm run typecheck
npm run build
```

Stejné kroky běží v GitHub Actions před mergem.

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
  domain/          # společný datový model + deal/material/filter scoring
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
5. Sbírat vlastní cenovou historii a postupně zvýšit její váhu ve finálním buy score.
6. Přidat druhý český e-shop a otestovat cross-shop matching.
