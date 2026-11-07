# MTG UA Community Card Searcher

Paste a Magic: The Gathering card list or deck, and the app checks Ukrainian online shops for every card at once.
It shows each card's offers side by side, the best price, and the cheapest total for the whole list (quantities included).

The UI is in Ukrainian.

## Shops

| Shop                | Site                                             |
| ------------------- | ------------------------------------------------ |
| MTGin               | [mtgin.kyiv.ua](https://mtgin.kyiv.ua)           |
| CartOn              | [carton.cards](https://carton.cards)             |
| Mana Vault          | [manavaultstore.com](https://manavaultstore.com) |
| Nerdik              | [nerdik.club](https://nerdik.club)               |
| Kartoteka           | [kartoteka.in.ua](https://kartoteka.in.ua)       |
| PayToWin (auctions) | [paytowin.club](https://paytowin.club)           |

Nerdik and PayToWin (auctions) are read from their APIs; the other shops don't offer one, so prices are scraped from their search pages.
A shop redesign can break its parser. If one shop stops returning results, that's the likely cause.

## Features

- **Card list input**: plain names (one per line), MTGGoldfish/MTGO text exports, or MTG Arena exports.
  Quantities are kept for the total; set codes, collector numbers, foil markers and section headers are stripped automatically.
- **Deck files**: drop or upload `.txt`, `.dec`, `.dek` (MTGO XML) or `.csv` (Moxfield, Deckbox, spreadsheets).
  Files are read in the browser and are never uploaded.
- **Results per card**:
    - exact matches first, sorted by price, with the best price highlighted
    - auctions, fuzzy "other matches" and Art Series cards in separate groups; the last two are collapsed by default
    - foil, language, condition, discount and stock badges where the shop provides them
- **Grid or table view**, remembered per browser.
- **Summary**: how many cards have an exact match, the number of offers, the cheapest total and which shops failed.
  The total counts exact matches only, for the quantity in the list, within each shop's stock. Cards with no exact match or too few copies are listed separately.
- Results for each card appear as soon as that card is done; there's no waiting for the whole list.

## Running locally

Requires [Bun](https://bun.com) 1.3 or newer.

```bash
bun install
bun dev        # dev server with hot reload, http://localhost:3000
```

Set `PORT` to use another port, e.g. `PORT=4000 bun dev`.

Nerdik's API needs a key: set `NERDIK_API_KEY`, e.g. in a `.env` file (Bun loads it; it's gitignored).
Without it, Nerdik searches fail with "NERDIK_API_KEY is not set" and the other shops still work.

### Production

```bash
bun start      # NODE_ENV=production, serves the app and the API
```

`bun start` bundles the frontend on startup, so there's no separate build step.
`bun run build` writes a static frontend bundle to `dist/` if you need one for other hosting; the server doesn't use it.

## How it works

```
browser ──POST /api/search {cards:[name]}──▶ Bun server
                                               │  one request per card, up to 6 at a time from the frontend
                                               ▼
                                     CardSearchService
                                               │  every shop, in parallel; a failing shop is reported, not fatal
                                               ▼
                         CachedCardSearcher (5 min per shop + card)
                                               ▼
                         <Shop>CardSearcher ──▶ ShopClient, one per shop (≥200 ms between requests, 15 s timeout, ≤30 s queue)
                                               ▼
                         parser: shop HTML/JSON → CardResult[]
```

- **Rate limiting:** a deck fans out to (cards × shops) requests. Each searcher's own `ShopClient` spaces out its shop's requests so the shops don't rate-limit us (HTTP 429).
  The queues are shared by every user, so a request that would wait more than 30 s fails as "server busy", and the frontend keeps at most 6 cards in flight.
- **Filtering:** the server keeps only listings whose name contains the searched card. Shop search is fuzzy, so "Sol Ring" also matches "Soldier of the Grey Host".
- **Grouping:** the browser groups the results.

## Project layout

```
src/
  index.ts                  Bun server: /api/search + serves the frontend
  shops.ts                  shared types, shop list, name matching (used by server and browser)
  decklist.ts, deckfile.ts  card list / deck file parsing, with counts (browser)
  results.ts                grouping offers per card, best price, the cheapest total (browser)
  i18n.ts                   Ukrainian plural forms
  server/
    shop-client.ts          rate-limited fetch with timeout, one per shop
    card-search-service.ts  searches all shops for one card
    cached-card-searcher.ts result cache
    searchers/              one per shop: which URLs to fetch
    parsers/                one per shop: turns a page into CardResult[]
  App.tsx                   page layout and state
  components/               UI (card-section.tsx renders a card's results, search-summary.tsx the totals)
  hooks/                    search, deck import, drag-and-drop
```

## Contributing

Format before committing:

```bash
bun run format
```

There's no test suite yet. Check types with `bunx tsc --noEmit`.
Expect a few errors in `build.ts`: that file comes from the Bun template and has always had them.

[AGENTS.md](AGENTS.md) covers conventions, the steps for adding a shop, and the known traps in more detail.

## Contact

- Telegram: [@CheeseSolari](https://t.me/CheeseSolari)
- Bugs and suggestions: [GitHub issues](https://github.com/AlexSolari/mtguacomminitycardsearcher/issues)
