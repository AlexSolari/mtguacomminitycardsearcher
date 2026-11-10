# AGENTS.md

Price comparison for Magic: The Gathering singles across Ukrainian online shops.
It's a Bun server that scrapes shop search pages, with a React 19 + Tailwind v4 frontend; the UI text is Ukrainian.
See [README.md](README.md) for what the app does and the request flow.

## Commands

| Task                                                                | Command                                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Dev server (hot reload, port 3000, `PORT` overrides)                | `bun dev`                                                                           |
| Production server                                                   | `bun start`                                                                         |
| Type-check                                                          | `bunx tsc --noEmit`                                                                 |
| Format                                                              | `bun run format` (or `bunx prettier --write <files>`)                               |
| Static frontend bundle                                              | `bun run build -- --outdir=<dir>` (defaults to `dist/`, which it **deletes first**) |
| Tests                                                               | `bun test` (offline, ~3 s)                                                          |
| Coverage (fails under 95% lines / 90% functions in any file)        | `bun run test:coverage`                                                             |
| Refresh the parser fixtures from the real shops                     | `bun scripts/update-fixtures.ts` (~7 requests)                                      |
| Re-render the link preview image (`src/og-image.png`, needs Chrome) | `bun scripts/render-og-image.ts`                                                    |

**Type-check baseline:** zero errors. `bun dev`, `bun run build` and `bun run test` run `bun check` first and stop on any type error.

**Tests** live in `tests/`, mirroring `src/` (`src/server/shop-client.ts` → `tests/server/shop-client.test.ts`), import with `@/`, and never touch the real shops.

- **Parsers** run against saved shop pages in `tests/fixtures/`, checked by snapshots.
  A parser change that alters output fails its snapshot. If the change is intended, review the diff and run `bun test --update-snapshots`.
  When a shop redesigns, refresh the fixtures, fix the parser, then update the snapshots.
  Prettier ignores `tests/fixtures/` and `__snapshots__/`, so formatting never rewrites them.
- **Fixtures hold no personal data:** `update-fixtures.ts` keeps only the PayToWin and MTGin fields the parsers read, dropping sellers, bidders and descriptions. Keep it that way for any new source.
- **New code:** add tests for it at the mirrored path in `tests/`. For a new shop, add its page to `update-fixtures.ts` and a test file next to the parser's mirrored path (`tests/server/parsers/{api,scrapers}/<shop>.test.ts`, using `parser-fixtures.ts`).
- **Server:** for an end-to-end check, start it on a spare port (`PORT=3917 bun src/index.ts`) and `curl -X POST localhost:3917/api/search -d '{"cards":["Sol Ring"]}'`.
  This hits the real shops, so keep it to a handful of requests.
- **UI:** there are no component tests. Say so when a change hasn't been checked in a browser.

## Code style

- **Formatting:** Prettier (`.prettierrc`): single quotes (JSX too), 4-space indent, no trailing commas. Run it on files you touch.
- **Comments:**
    - match the surrounding density: a short comment above anything non-obvious, explaining _why_
    - parsers show the markup they expect, as an example in the comment
    - no comments that just restate the code
- **UI text is Ukrainian; code and comments are English.**
    - counts go through `plural(n, FORMS)` in `src/i18n.ts`; never hand-write "карт/карти"
    - add new plural forms there
- **Imports:** `@/` = `src/`. In type-only imports, use `import type`; `verbatimModuleSyntax` is on.
- **Files:** kebab-case file names. Components go in `src/components/`, hooks in `src/hooks/`, shadcn primitives in `src/components/ui/`, tests in `tests/`.
- **Icons:** lucide-react, except brand logos. lucide is removing those, so they're inline SVGs in `components/icons.tsx`.
- **Light and dark themes:** colours must work in both. Use the theme tokens (`text-primary`, `bg-card`, …), which `src/index.css` defines for each; give a hard-coded colour a `dark:` variant (`text-emerald-700 dark:text-emerald-400`).
  Overlays on card images (`bg-black/70 text-white`) are the exception: the image is behind them in both themes.
  The theme choice logic is in `src/theme.ts`, and the inline script in `index.html` repeats it before first paint; change both together.

## Architecture rules

- **Three modules are shared with the browser** and must not import anything server-only:
    - `src/shops.ts`: the shop registry (`ShopId`, `SHOP_INFO`, `manualSearchUrl`)
    - `src/search-result.ts`: the API types (`CardResult`, `SearchResult`, `SearchError`), types only
    - `src/matching.ts`: name matching (`normalize`, `isExactMatch`, `isArtSeries`)
- **Parsers** are pure: string/JSON in, `CardResult[]` out, no fetching.
  JSON API parsers go in `src/server/parsers/api/<shop>.ts`, HTML scrapers in `src/server/parsers/scrapers/<shop>.ts`.
  Shared helpers (`decodeEntities`, `parsePrice`, `abs`, `languageCode`) live in `parsers/helpers.ts`.
  Parsers that resolve relative links take a `base` argument (the searcher passes `client.baseUrl`); don't hardcode the shop's URL.
- **Searchers** (`src/server/searchers/<shop>-card-searcher.ts`) decide which URLs to fetch and call the parsers.
  They **must** fetch through their own `ShopClient` (created in the constructor with the shop's base URL), never `fetch` directly; it provides the shop's rate limit, timeout and queue cap.
  Build URLs with `client.url(path, params)`. The client refuses URLs on other hosts.
  Scrapers pass every parser result through `warnIfEmpty`: an empty parse is how a shop redesign shows up, so it's logged.
  API searchers don't: an empty API response just means nothing is in stock.
  Pass `search()`'s `signal` to every client call (`{ signal }`), so abandoned searches leave the shop's queue.
  An optional follow-up request that falls back on failure goes through `warnFallback` in its `catch`, never a silent catch.
  Prefer a page or API that lists every offer at once (Mana Vault's `/api/v1/prices`). Where a shop has none and its search shows only a printing's cheapest price (CartOn), fetch each printing's page through `expandCheapest`, which caps them at `MAX_PRODUCT_PAGES` per search; don't fetch product pages around it.
- **Wiring:** searchers are registered in `src/index.ts`, each wrapped in `CachedCardSearcher`.
  The `/api/search` handler lives in `src/server/search-route.ts` (input checks, `InFlightLimiter`, NDJSON streaming: a `SearchUpdate` line per card each time a shop finishes), so it's tested without starting a server.
  `/api/click` (`src/server/click-route.ts`) records which offer a user opened (the frontend sends it with `reportClick` in `src/lib/report-click.ts`) as an `offer click` span.
- **One instance only:** the shop rate limits, the result cache, the per-client limiter and MTGin's batching all live in process memory.
  A second replica would double the request rate to every shop and split MTGin's and Mana Vault's 60-a-minute budgets. Don't scale horizontally without moving those to shared state first.
- **Logging:** server code logs through `logger` in `src/server/logger.ts`, never `console.*`.
    - the message is a fixed string, and everything that varies goes in fields: `logger.warn('parser found nothing', { shop, url })`
    - pass errors as a field (`error: err`); the logger serializes them
    - production writes JSON lines to stdout in Railway's structured format (`message`, `level`, every other key a filterable attribute); elsewhere it writes one readable line. `LOG_LEVEL` and `LOG_FORMAT` override this
    - tests call `captureLogs()` from `tests/server/capture-logs.ts` and assert on the records, not on `console`
    - never log client IPs. To count unique visitors, use `VisitorIds` (`src/server/visitor-id.ts`): a daily-salted hash that's never stored. Don't add a cookie or a localStorage id; that would need a consent banner
- **Prices:**
    - `price` is in UAH, or `null` when unknown; never `0` for "unknown"
    - set `fromPrice` when the price is the cheapest of several offers
    - auctions set `auction`, and their price never counts toward best price or totals
    - the summary total uses exact matches only, times the list quantity, within stock (`cheapestCopies` in `src/results.ts`)

### Adding a shop

1. **Shop info:** add its id to `ShopId` and an entry to `SHOP_INFO` in `src/shops.ts` (label, homepage, favicon).
2. **Parser:** write `src/server/parsers/api/<shop>.ts` if the shop has a JSON API, otherwise `src/server/parsers/scrapers/<shop>.ts`. Start with a comment showing the markup or JSON shape it reads.
    - Fill the optional `CardResult` fields the shop exposes: foil, language, stock, condition, old price.
    - Drop out-of-stock items unless the shop only lists in-stock ones.
3. **Searcher:** write `src/server/searchers/<shop>-card-searcher.ts`, following an existing one.
4. **Register it:** add it to the list in `src/index.ts`.
5. **Check:** add the shop's page to `scripts/update-fixtures.ts` and `tests/server/parsers/{api,scrapers}/<shop>.test.ts`, then run one live search.

## Traps (each of these has bitten before)

- **Name matching goes through `normalize`:** it lower-cases, strips diacritics and expands `æ`.
  Use `isExactMatch` / `normalize` for every name comparison, never raw string equality.
  "Æther Vial" vs "Aether Vial" and "Lim-Dûl" vs "Lim-Dul" both depend on it.
- **`parsePrice` returns `null` when there are no digits.** Don't "simplify" it back to `Number(...)`: that turns "—" into 0 ₴, which then wins best price.
- **Decimal prices:** `"1 234,50"` parses as 123450. No shop shows kopecks today. Handle it per shop if one starts.
- **MTGin batches its searches:** the API key allows 60 requests a minute, shared by every user. `GinCardSearcher` sends concurrent searches as one request (up to 100 cards), one request at a time, at most one a second. Don't turn it back into a request per card.
  Nerdik's and Mana Vault's batch APIs are batched the same way; all three go through `Batcher` (`src/server/batcher.ts`).
- **Mana Vault's price API allows 60 requests a minute per IP, with no key**, shared by every user ([docs](https://manavaultstore.com/api/docs)).
    - The minute is a fixed window that starts at its first request, so its client spaces requests 1.1 s apart (`intervalMs: 1100`), leaving slack for network jitter. Don't lower it.
    - `POST /api/v1/prices` takes up to 50 names, but every 10 names count as one request. `ManavaultCardSearcher` sends batches of at most 10: bigger ones spend the budget faster without finding cards any faster.
    - A name the API rejects (under 2 letters) gets an `error` in its own answer rather than failing the batch; the searcher fails only that card.
- **Nerdik's batch API matches only a card's full name:** "Bonecrusher Giant // Stomp" finds it, "Bonecrusher Giant" finds nothing.
  The name resolver gives shops the front face, so searchers also get `fullName` (Scryfall's name for the whole card) as the third argument of `search()`; `NerdikCardSearcher` searches by it.
  `CachedCardSearcher` keys on both names.
- **Two Bun versions:** `bun-plugin-tailwind` pulls a project-local Bun into `node_modules` (1.4.4 today), and `bun run <script>` (`bun dev`, `bun start`, `bun run test:coverage`) uses it.
  A bare `bun …` uses the global install, which may be older. Behaviour and coverage numbers can differ between them; when in doubt, go through a script.
- **`Bun.serve`'s `idleTimeout` (in `src/index.ts`) must outlast the slowest shop.** The default 10 s dropped streams while Kartoteka was still searching.
- **The result cache is 5 minutes.** When testing parser changes against a running server, restart it, or you'll see cached results.
- **Frontend performance relies on stable `SearchResult` objects:**
    - `CardSection` is `memo`ized
    - `splitMatches` caches per result object in a `WeakMap`
    - replace results immutably, and never mutate a finished result
- **Single-column grids need `grid-cols-1` (`minmax(0, 1fr)`).** Otherwise the column grows to fit long content, like the collapsed card-list bar, and the whole page overflows.

## Scraping etiquette

- **Request rate:** keep it at or below today's (≥200 ms between requests per shop, at most 6 cards in flight per browser tab).
- **Bot challenges:** some shop pages sit behind one, like Kartoteka's product pages and Nerdik's "in stock" filter URL. Work from the pages that don't, rather than trying to get around the challenge.
- **Live testing:** a few searches at most; don't loop over many cards against the real shops.
