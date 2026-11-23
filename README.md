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
| Magic Swamp         | [magicswamp.com.ua](https://magicswamp.com.ua)   |
| Citadel             | [citadel.kyiv.ua](https://citadel.kyiv.ua)       |

MTGin, CartOn, Mana Vault, Nerdik, PayToWin (auctions) and Magic Swamp are read from their APIs; the other shops (Kartoteka, Citadel) don't offer one, so prices are scraped from their pages.
MTGin's and Nerdik's APIs match card names exactly, so they never contribute fuzzy "other matches".
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
- **Filters**: foil or non-foil, and which languages and shops to show (traders' lists among them), remembered per browser. They apply to the results and the summary without searching again.
  An offer that doesn't say its language or finish is kept: Kartoteka and traders' lists give no language, and some shops leave out the foil flag on regular cards.
- **Order plan** ("Розподіл по магазинах", next to the shop filter): which shop to buy each card from, among the shops ticked, with the foil and language filters applied. One block per shop with its cards, links and subtotal, and what leaving that shop out would cost.
  Delivery isn't counted yet; instead, a table gives the cheapest plan for each number of shops (every combination is tried), so the trade-off between price and number of orders is visible. Traders who have cards of the list are listed under it, outside the totals.
  It's a view of the search page (`#plan`), so it needs no second search, and Back returns to the results.
- **Summary**: how many cards have an exact match, the number of offers, the cheapest total and which shops failed.
  The total counts exact matches only, for the quantity in the list, within each shop's stock. Cards with no exact match or too few copies are listed separately.
- Results for each card appear as soon as each shop answers; there's no waiting for the whole list or the slowest shop.
- **Shareable links**: the search is kept in the page's URL (`?q=Fatal+Push&q=2+Consider`), so a link opens the same list and searches it.
- **Not found**: cards that no shop has are listed together.
- **Blocked shops**: when a shop refuses our server (HTTP 403, as Nerdik and Kartoteka do to some server IPs), the card links to that shop's own search to check by hand.
- **Light and dark themes**, following the system setting unless you pick one.
- **Traders' lists**: people who sell cards in Telegram groups sign in with Telegram on `/lists` and add their MTGGoldfish, ManaBox or Moxfield lists: one link, or a whole Telegram post with several (every list linked in it is added).
  Once a moderator approves a list on `/admin`, its cards show under each card as "Гравці", with the seller's Telegram and Scryfall's USD price as a guide; they never count toward best price or the total.
  Lists are read again every night. A trader can delete a list, or their whole account, at any time.

## Running locally

Requires [Bun](https://bun.com) 1.4.3 or newer (for `bun check`, the built-in type checker the scripts run).

```bash
bun install
bun dev        # dev server with hot reload, http://localhost:3000
bun test       # offline test suite; parsers run against saved shop pages
```

Set `PORT` to use another port, e.g. `PORT=4000 bun dev`.

The MTGin, CartOn and Nerdik APIs need keys: set `MTGIN_API_KEY`, `CARTON_API_KEY` and `NERDIK_API_KEY`, e.g. in a `.env` file (Bun loads it; it's gitignored).
Without a key, that shop's searches fail with "… is not set" and the other shops still work.

Traders' lists are stored in SQLite at `DB_PATH` (default `data/cardsearcher.db`, gitignored), created on first start.
Signing in needs a Telegram bot with Login Widget set up in @BotFather, with `<site URL>/api/auth/callback` as a redirect URI:

| Variable                                       | What                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `TELEGRAM_CLIENT_ID`, `TELEGRAM_CLIENT_SECRET` | the bot's client ID and secret; without them sign-in is off and the rest of the site works       |
| `ADMIN_TELEGRAM_IDS`                           | comma-separated numeric Telegram ids of the moderators                                           |
| `TELEGRAM_BOT_TOKEN`                           | the bot's API token; the bot then messages each moderator when a trader submits lists            |
| `PUBLIC_URL`                                   | the site's address for the redirect; defaults to Railway's domain, else `http://localhost:$PORT` |
| `DB_PATH`                                      | the database file                                                                                |

Telegram may not accept a `localhost` redirect; a tunnel (VS Code's port forwarding, for one) gives an `https` address to use as `PUBLIC_URL`.
For the messages, each moderator presses Start in the bot once: a bot can't write to someone who hasn't.
`bun dev` reads approved lists in the local database from MTGGoldfish, ManaBox and Moxfield, so keep experiments to a few lists.

### Production

```bash
bun start      # NODE_ENV=production, serves the app and the API
```

`bun start` bundles the frontend on startup, so there's no separate build step.
`bun run build` writes a static frontend bundle to `dist/` if you need one for other hosting; the server doesn't use it.

Tracing is optional: `bun start` sends spans over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (Railway sets it when tracing is on), and to Sentry, along with server errors, when `SENTRY_DSN` is set. With neither, nothing is sent.

## How it works

```
browser ──POST /api/search {cards:[…]}──▶ Bun server
                                               │  the first 2 cards in a request of their own, then the rest (100 per request)
                                               │  names resolved from a local copy of Scryfall's card names; the rest by its API (the first 2 one by one, the rest in bulk)
                                               ▼
                                     CardSearchService
                                               │  per client and shop: 6 cards at a time, a whole list for batched APIs
                                               │  every shop, in parallel; a failing shop is reported, not fatal
                                               │  streams the card's result (NDJSON) each time a shop finishes
                                               ▼
                         CachedCardSearcher (10 min per shop + card)
                                               ▼
                         <Shop>CardSearcher ──▶ ShopClient, one per shop (≥200 ms between requests, 15 s timeout, ≤30 s queue)
                                               ▼
                         parser: shop HTML/JSON → CardResult[]
```

- **Rate limiting:** a deck fans out to (cards × shops) requests. Each searcher's own `ShopClient` spaces out its shop's requests so the shops don't rate-limit us (HTTP 429).
  The queues are shared by every user, so a request that would wait more than 30 s fails as "server busy", and each client has at most 6 cards at a time at each shop.
  Each shop goes through a list at its own pace, so a slow shop doesn't hold back the others; the batched APIs (MTGin, Nerdik, Mana Vault, CartOn) get the whole list at once.
- **Streaming:** `/api/search` answers in NDJSON, a line per card each time one of its shops finishes, so a slow shop (Kartoteka) doesn't hold back the others; the card shows which shops are still searching.
- **Filtering:** the server keeps only listings whose name contains the searched card. Shop search is fuzzy, so "Sol Ring" also matches "Soldier of the Grey Host".
- **Grouping:** the browser groups the results.
- **Traders' lists:** a job in the server reads each approved list right after approval and then every night, 02:00–07:00 Kyiv time, when traffic is lowest (one request every 5 s per source), prices rows from Scryfall in USD, and stores them in SQLite. Search reads them from there alongside the shops, uncached.

## Project layout

```
src/
  index.ts                  Bun server: /api/search, /api/click, sign-in and lists, serves the frontend
  instrumentation.ts        OpenTelemetry / Sentry setup, preloaded by `bun start`
  index.html, frontend.tsx  the browser entry; frontend.tsx picks the page by path
  index.css                 the theme (light and dark tokens) and app-wide styles, over styles/globals.css (shadcn's base)
  shared/                   used by both server and browser
    shops.ts                shop list
    search-result.ts        API result types
    account.ts              sign-in and lists API types
    matching.ts             card name matching
    i18n.ts                 Ukrainian plural forms
  pages/                    search-page.tsx, lists-page.tsx (traders' lists), admin-page.tsx (moderation)
  components/               UI; ui/ holds the shadcn primitives
    search/                 the search page: card-section.tsx renders a card's results, search-summary.tsx the
                            totals, order-planner.tsx the cheapest order; offer-*.tsx the pieces of one offer
    lists/                  the traders' and moderators' pages: their lists, account, moderation
    layout/                 header, footer, page frame, theme toggle
    icons.tsx, shop-badge.tsx  used across pages
  hooks/                    search, deck import, drag-and-drop, filters, theme, account
  lib/                      browser logic
    decklist.ts, deckfile.ts  card list / deck file parsing, with counts
    results.ts              grouping offers per card, best price, the cheapest total
    format.ts               prices, dates and countdowns as the UI shows them
    filters.ts              offer filters (shops, foil, language, condition…)
    order-plan.ts           which shops to buy each card from
    search-url.ts           shareable search URLs
    report-click.ts         click reporting
    account-api.ts          the account and lists API client
    usd-rate.ts, theme.ts, near-viewport.ts, utils.ts
  server/
    search/
      search-route.ts       POST /api/search: input checks, per-client limit, NDJSON streaming
      click-route.ts        POST /api/click: records which offer a user opened
      card-search-service.ts  searches all shops for one card
      cached-card-searcher.ts result cache
      card-searcher.ts      the interface each shop's searcher implements
    scryfall/
      name-resolver.ts      resolves each typed name to the card's name: card-index.ts first, then Scryfall's API
      card-index.ts         local card name lookup, from card-names.json (scripts/update-card-names.ts)
      scryfall-client.ts    the API client, shared by name lookups and traders' list prices
    shops/                  one folder per shop (MTGin is gin/)
      <shop>/<shop>-card-searcher.ts  which URLs to fetch
      <shop>/<shop>-parser.ts         turns a response (JSON API or HTML page) into CardResult[]
      parse-helpers.ts      shared by the parsers: prices, entities, links, languages
    outbound/               requests we send
      shop-client.ts        rate-limited fetch with timeout, one per shop
      circuit-breaker.ts    stops calling a shop that keeps failing, for 60 s
      batcher.ts            many cards per request for the batched APIs (MTGin, Nerdik, Mana Vault, CartOn)
      window-budget.ts      Mana Vault's 60-requests-a-minute budget
    http/                   requests we receive: client ids, per-client limits, body reading, JSON answers
    observability/          structured logs, spans, Sentry, unique visitor counts
    auth/                   Telegram sign-in (OpenID Connect), sessions, users (user-store.ts)
    db/                     SQLite: the connection and the schema's migrations
    lists/                  traders' lists: /api/lists (lists-route.ts) and /api/admin (admin-route.ts), links,
                            parsers (MTGGoldfish, ManaBox, Moxfield), storage (list-store.ts), nightly refresh,
                            Scryfall prices, search (trader-list-searcher.ts), moderators' notifications
```

## Contributing

Format before committing:

```bash
bun run format
```

Run the tests with `bun run test`; it type-checks first and stops on any type error.

[AGENTS.md](AGENTS.md) covers conventions, the steps for adding a shop, and the known traps in more detail.

## Contact

- Telegram: [@CheeseSolari](https://t.me/CheeseSolari)
- Bugs and suggestions: [GitHub issues](https://github.com/AlexSolari/mtguacomminitycardsearcher/issues)
