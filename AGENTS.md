# AGENTS.md

Price comparison for Magic: The Gathering singles across Ukrainian online shops.
It's a Bun server that scrapes shop search pages, with a React 19 + Tailwind v4 frontend; the UI text is Ukrainian.
See [README.md](README.md) for what the app does and the request flow.

## Commands

| Task                                                                | Command                                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Dev server (hot reload, port 3000, `PORT` overrides)                | `bun dev`                                                                           |
| Production server                                                   | `bun start`                                                                         |
| Type-check                                                          | `bun check`                                                                         |
| Format                                                              | `bun run format` (or `bunx prettier --write <files>`)                               |
| Static frontend bundle                                              | `bun run build -- --outdir=<dir>` (defaults to `dist/`, which it **deletes first**) |
| Tests                                                               | `bun test` (offline, ~6 s)                                                          |
| Coverage (fails under 95% lines / 90% functions in any file)        | `bun run test:coverage`                                                             |
| Refresh the parser fixtures from the real shops                     | `bun scripts/update-fixtures.ts` (~11 requests)                                     |
| Re-render the link preview image (`src/og-image.png`, needs Chrome) | `bun scripts/render-og-image.ts`                                                    |
| Refresh the card name index (`src/server/search/card-names.json`)   | `bun scripts/update-card-names.ts [oracle-cards.json]` (after each set release)     |

**Type-check baseline:** zero errors. `bun dev`, `bun run build`, `bun run test` and `bun run test:coverage` run `bun check` first and stop on any type error.
TypeScript isn't a dependency: don't use `bunx tsc`, which fetches an unrelated npm package named `tsc`.

**Tests** live in `tests/`, mirroring `src/` (`src/server/outbound/shop-client.ts` → `tests/server/outbound/shop-client.test.ts`), import with `@/`, and never touch the real shops.

- **Parsers** run against saved shop pages in `tests/fixtures/`, checked by snapshots.
  A parser change that alters output fails its snapshot. If the change is intended, review the diff and run `bun test --update-snapshots`.
  When a shop redesigns, refresh the fixtures, fix the parser, then update the snapshots.
  Prettier ignores `tests/fixtures/` and `__snapshots__/`, so formatting never rewrites them.
- **Fixtures hold no personal data:** `update-fixtures.ts` keeps only the fields the parsers read (via `pick`), dropping sellers, bidders, descriptions and cart reservations (PayToWin, MTGin, Magic Swamp, Citadel, Mana Vault; CartOn's GraphQL query asks for no seller fields). Traders' lists keep only the list: MTGGoldfish's deck field, ManaBox's island cut down to the fields `parseManabox` reads, and Moxfield's deck cut down to its name, edit date and boards, each row to the fields `parseMoxfield` reads (no owner or authors). Keep it that way for any new source.
- **Database tests** open `openDatabase(':memory:')`, a fresh migrated database per test; its migration logs a line, so tests that assert on logs clear them after opening it.
  CartOn's, Nerdik's and MTGin's fixtures need `CARTON_API_KEY` / `NERDIK_API_KEY` / `MTGIN_API_KEY` in `.env`; without a key that fixture is left as it is.
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
    - counts go through `plural(n, FORMS)` in `src/shared/i18n.ts`; never hand-write "карт/карти"
    - add new plural forms there
- **Imports:** `@/` = `src/`. Import anything in `src/` through `@/`, never `./` or `../`, so a file can move without breaking its imports (only `tests/` and `scripts/` reach their own helpers relatively). In type-only imports, use `import type`; `verbatimModuleSyntax` is on.
- **Files:** kebab-case file names. Each folder holds one kind of file; the root of `src/` keeps only the entry points (`index.ts` server, `frontend.tsx` / `App.tsx` / `index.html` browser, `instrumentation.ts`) and assets.
    - `src/shared/`: code both the server and the browser import (see Architecture rules)
    - browser: components in `src/components/` (shadcn primitives in `src/components/ui/`), hooks in `src/hooks/`, all other browser logic in `src/lib/`
    - server, in `src/server/`: `search/` (search and click routes, the search pipeline, name resolving), `searchers/` and `parsers/` (one per shop), `outbound/` (requests we send: `ShopClient`, circuit breaker, batching, budgets), `http/` (requests we receive: per-client limits, body reading), `observability/` (logs, spans, visitor counts), `auth/`, `db/`, `lists/` (traders' lists, their route and notifications)
    - a new file goes in the folder of its kind; if none fits, add a folder rather than leaving it loose in `src/` or `src/server/`
    - tests in `tests/`, at the mirrored path
- **Icons:** lucide-react, except brand logos. lucide is removing those, so they're inline SVGs in `components/icons.tsx`.
- **Light and dark themes:** colours must work in both. Use the theme tokens (`text-primary`, `bg-card`, …), which `src/index.css` defines for each; give a hard-coded colour a `dark:` variant (`text-emerald-700 dark:text-emerald-400`).
  Overlays on card images (`bg-black/70 text-white`) are the exception: the image is behind them in both themes.
  The theme choice logic is in `src/lib/theme.ts`, and the inline script in `src/index.html` repeats it before first paint; change both together.

## Architecture rules

- **`src/shared/` is imported by both the server and the browser**, so it must not import anything server-only (nor browser-only):
    - `shops.ts`: the shop registry (`ShopId`, `SHOP_INFO`, `SHOP_IDS`, `manualSearchUrl`)
    - `search-result.ts`: the API types (`CardResult`, `SearchResult`, `SearchError`), types only
    - `account.ts`: the account and lists API types (`AuthState`, `MyList`, `ModeratedList`, error codes), types only
    - `matching.ts`: name matching (`normalize`, `isExactMatch`, `isArtSeries`)
    - `i18n.ts`: Ukrainian plural forms (the browser's counts, and the moderators' Telegram notifications)
- **Parsers** are pure: string/JSON in, `CardResult[]` out, no fetching.
  JSON API parsers go in `src/server/parsers/api/<shop>.ts`, HTML scrapers in `src/server/parsers/scrapers/<shop>.ts`.
  Shared helpers (`decodeEntities`, `toPrice`, `abs`, `languageCode`) live in `parsers/helpers.ts`.
  Parsers that resolve relative links take a `base` argument (the searcher passes `client.baseUrl`); don't hardcode the shop's URL.
- **Searchers** (`src/server/searchers/<shop>-card-searcher.ts`) decide which URLs to fetch and call the parsers.
  They **must** fetch through their own `ShopClient` (created in the constructor with the shop's base URL), never `fetch` directly; it provides the shop's rate limit, timeout, queue cap and circuit breaker (after 3 timeouts, dropped connections or 502/503/504 in a row, the shop's requests fail at once for 60 s; `src/server/outbound/circuit-breaker.ts`).
  Build URLs with `client.url(path, params)`. The client refuses URLs on other hosts.
  Scrapers pass every parser result through `warnIfEmpty`: an empty parse is how a shop redesign shows up, so it's logged.
  API searchers don't: an empty API response just means nothing is in stock.
  Pass `search()`'s `signal` to every client call (`{ signal }`), so abandoned searches leave the shop's queue.
  An optional follow-up request that falls back on failure goes through `warnFallback` in its `catch`, never a silent catch.
  Prefer a page or API that lists every offer at once (Mana Vault's `/api/v1/prices`, CartOn's GraphQL) over fetching each printing's page.
- **Wiring:** searchers are registered in `src/index.ts`, each shop's wrapped in `CachedCardSearcher`. `TraderListSearcher` is the exception (see Traders' lists).
  The `/api/search` handler lives in `src/server/search/search-route.ts` (input checks, per-client limits at each shop (`ShopLimits`), NDJSON streaming: a `SearchUpdate` line per card each time a shop finishes), so it's tested without starting a server.
  `/api/click` (`src/server/search/click-route.ts`) records which offer a user opened (the frontend sends it with `reportClick` in `src/lib/report-click.ts`) as an `offer click` span.
- **Per-client limits:** both routes answer 429 with `Retry-After` past a client's limit: cards searched over time (`SEARCH_BUCKETS`) and cards still pending (`MAX_PENDING_CARDS`) for search, clicks over time (`CLICK_BUCKETS`) for click. Sign-in's callback is limited too (`SIGN_IN_BUCKETS`, counted just before the token exchange with Telegram), and sends a client past it back to `/lists?login=busy`. All go through `RateLimiter` (`src/server/http/rate-limiter.ts`).
  A client is its IP, or its /64 for IPv6 (`clientKey`), since one customer holds the whole /64.
  `logger.error` reports at most `SENTRY_EVENTS_PER_MINUTE` Sentry events per message; the rest are only logged.
- **One instance only:** the shop rate limits, the result cache, the per-client limiters and MTGin's batching all live in process memory, and the traders' database is a SQLite file on the instance's volume.
  A second replica would double the request rate to every shop, split MTGin's and Mana Vault's 60-a-minute budgets, and have a database of its own. Don't scale horizontally without moving those to shared state first.
- **Logging:** server code logs through `logger` in `src/server/observability/logger.ts`, never `console.*`.
    - the message is a fixed string, and everything that varies goes in fields: `logger.warn('parser found nothing', { shop, url })`
    - pass errors as a field (`error: err`); the logger serializes them
    - production writes JSON lines to stdout in Railway's structured format (`message`, `level`, every other key a filterable attribute); elsewhere it writes one readable line. `LOG_LEVEL` and `LOG_FORMAT` override this
    - `logger.error` also reports to Sentry when it's configured (see Tracing)
    - tests call `captureLogs()` from `tests/server/capture-logs.ts` and assert on the records, not on `console`
    - never log client IPs. To count unique visitors, use `VisitorIds` (`src/server/observability/visitor-id.ts`): a daily-salted hash that's never stored. Don't add a cookie or a localStorage id; that would need a consent banner
    - the one cookie is the traders' sign-in session (`session`, plus `tg_login` while signing in): set only when someone signs in, so it's strictly necessary and needs no banner. Anonymous visitors still get none
    - never log traders' Telegram ids, usernames or names, nor put them in spans: log `user`, the database id
- **Prices:**
    - `price` is in UAH, or `null` when unknown; never `0` for "unknown"
    - set `fromPrice` when the price is the cheapest of several offers
    - auctions set `auction`, and their price never counts toward best price or totals
    - the summary total uses exact matches only, times the list quantity, within stock (`cheapestCopies` in `src/lib/results.ts`)
    - traders' offers have `price: null` and carry Scryfall's USD price in `usdPrice` (`approxPrice` when it isn't for that exact printing); they're their own group (`splitMatches().traders`) and never count toward best price or totals
    - a trader can set an exchange rate (UAH per USD) for all their lists and override it per list; the offer then carries `usdRate`, and `sellerUah` in `src/lib/results.ts` gives the UAH price shown. It's still a guide: `price` stays `null`, and the group stays out of best price and totals, sorted by `usdPrice`

- **Tracing:** `bun start` preloads `src/instrumentation.ts`, which starts OpenTelemetry only when `OTEL_EXPORTER_OTLP_ENDPOINT` (Railway) or `SENTRY_DSN` is set; otherwise the spans in the code (`tracer` in `src/server/observability/tracing.ts`) are no-ops, so dev and tests are unaffected.
  Tests assert on spans with `tests/server/capture-spans.ts`.
- **Secrets:** MTGin, CartOn and Nerdik need `MTGIN_API_KEY`, `CARTON_API_KEY` and `NERDIK_API_KEY` (Bun loads `.env`). Without one, that shop fails every search with an error rather than silently finding nothing.
  Traders' sign-in needs `TELEGRAM_CLIENT_ID` and `TELEGRAM_CLIENT_SECRET` (see Traders' lists); without them it's off and the rest of the site works.
  Moderators' notifications need `TELEGRAM_BOT_TOKEN`, the bot's API token (not the Login Widget's secret); without it they're off.

### Traders' lists

Traders sign in with Telegram, add their MTGGoldfish, ManaBox or Moxfield lists on `/lists`, and moderators approve them on `/admin`. Approved lists' cards show in search under "Гравці".

- **Storage:** `bun:sqlite` at `DB_PATH` (default `data/cardsearcher.db`, gitignored; on Railway, a file on a volume). `src/server/db/database.ts` holds the schema as numbered migrations (`MIGRATIONS`, tracked in `user_version`): add a new one, never edit a shipped one. Tables are STRICT, with foreign keys on, so deleting a user deletes their sessions, lists and cards.
- **Sign-in** (`src/server/auth/`): Telegram's OpenID Connect, code flow with PKCE, done by the server. The ID token is verified against Telegram's JWKS. Sessions are a random token in an HttpOnly cookie; the database keeps its sha256 only. Accounts without a username are turned away: buyers couldn't contact them.
  Moderators are the Telegram ids in `ADMIN_TELEGRAM_IDS` (comma-separated). The redirect URL is `PUBLIC_URL` (else `https://$RAILWAY_PUBLIC_DOMAIN`, else `http://localhost:$PORT`) plus `/api/auth/callback`, and must be registered in @BotFather → Login Widget exactly.
- **Routes:** `/api/auth/*` (`auth-route.ts`: sign-in, `me`, logout, account deletion) and `/api/lists`, `/api/admin/*` (`lists-route.ts`: a trader's lists, up to `MAX_LISTS_PER_USER`; moderation, search over lists and sellers (`?q=`, filtered in code since SQLite's `LIKE` doesn't lower-case Cyrillic), and bans). Writes take JSON only, which with the SameSite=Lax cookie keeps other sites from sending them.
- **Reading lists** (`src/server/lists/`): `list-link.ts` parses the links traders paste; the parsers in `lists/parsers/` follow the shop parsers' rules (pure, markup in the comment, snapshot-tested). MTGGoldfish's deck pages are behind a Cloudflare challenge, so lists are read from its proxy printer (`/proxies/new?id=`), which isn't.
  Moxfield's are read from its JSON API (`api2.moxfield.com/v3/decks/all/<id>`; v2 merges a card's printings into one row); see the exception under Scraping etiquette.
  `ListRefresher` runs in the server process and reads lists one at a time, through `ListReader`'s `ShopClient`s (one request per 5 s per source). Scheduled reads happen **only at night**, 02:00–06:59 Kyiv time, when traffic is lowest (`night-schedule.ts`): an in-process `Bun.cron` checks every 5 minutes through the window, and each list has its own slot in it (from its id), so lists spread over the night. After a good read the next is the list's slot the following night. A failure keeps the old cards, stores a `ListRefreshError` the owner sees, and retries after 1, 2, 4… hours, then daily; a retry that would land in the day waits for the list's slot.
  Approving a list and a moderator's refresh (`/admin`) read those lists at once, whatever the hour (`run(ids)`), and nothing else. Banned users' lists are never read, neither at night nor on request, until the ban is lifted.
  `ListPrices` prices rows without one from Scryfall's `/cards/collection` (USD for the row's finish), cached a day in `card_prices`, through the name resolver's collection client so both stay within Scryfall's limit.
  MTGGoldfish's promos (`[PRM-MSC]`, `[PRM-PRE]`…) name a group, not a set, so each is a `/cards/search` of its own on the same client: `pickPromo` takes the printing whose set name or promo types match the row's `<…>` and the group ("Store Championship" → Store Championships), and only when exactly one does; otherwise the row is priced by name, as `≈`.
- **Notifications:** when a submission adds lists, `AdminNotifier` (`src/server/lists/admin-notifier.ts`, wired through `listsHandlers`' `onSubmitted`) sends each moderator one Telegram message from the bot: the trader, the lists' links, the queue's size and a button to `/admin`. Silent 23:00–07:59 Kyiv time. After a message about a trader, lists they submit within `COOLDOWN_MS` are held and go in one message when it ends, so adding lists one at a time (or a script looping) doesn't flood the moderators. It never fails or delays the submission; a failure is a `logger.warn`.
  A moderator gets them only after pressing Start in the bot. The token is in the API's URL path, so its `ShopClient` gets it as `secret`, which masks it in spans and errors; any credential in a URL goes that way.
- **Search:** `TraderListSearcher` reads the database: no `ShopClient` and no `CachedCardSearcher`, so a list shows as soon as it's read. Its offers' `url` is the trader's Telegram; `seller` carries the list.

### Adding a shop

1. **Shop info:** add its id to `ShopId` and an entry to `SHOP_INFO` in `src/shared/shops.ts` (`label`, `homepage`, `icon`; `searchUrl` if the shop may answer our server 403 and the user should get a link to search it by hand, see `manualSearchUrl`).
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
- **Every price goes through `toPrice`:** it gives `null` for anything unknown, including 0. Don't use `Number(...)` alone or a bare `typeof` check: they turn `null` or `""` into 0, or let a listed 0 through, and 0 ₴ wins best price.
  It reads JSON numbers and decimal strings (`"183.00"`), not formatted text (`"1 234 ₴"`); no shop gives prices that way today.
- **MTGin batches its searches:** the API key allows 60 requests a minute, shared by every user. `GinCardSearcher` sends concurrent searches as one request (up to 100 cards), one request at a time, at most one a second. Don't turn it back into a request per card.
  Nerdik's and Mana Vault's batch APIs are batched the same way; all three go through `Batcher` (`src/server/outbound/batcher.ts`).
- **Mana Vault's price API allows 60 requests a minute per IP, with no key**, shared by every user ([docs](https://manavaultstore.com/api/docs)).
    - The minute is a fixed window that starts at the API's first request after the last one ended (not at :00, not rolling). `WindowBudget` (`src/server/outbound/window-budget.ts`) mirrors it: requests go out at once until 55 are spent, then wait for the next window.
    - Our window is timed from when its first request _settles_, which is always after the API received it, plus a second. Timing it from the send could end ours before theirs. The 55 (not 60) covers a request that straddles two windows.
    - `POST /api/v1/prices` takes up to 50 names, and every 10 names count as one request. `ManavaultCardSearcher` sends batches of up to 50 and charges each `ceil(names / 10)`.
    - A 429 spends the rest of the window (`exhaust()`): the API has counted more than we have, e.g. another client on our IP.
    - A name the API rejects (under 2 letters) gets an `error` in its own answer rather than failing the batch; the searcher fails only that card.
- **CartOn's GraphQL API allows 120 requests a minute per key**, shared by every user, and refuses any query scoring over 500 (`products`' and `offers`' `first` must also be 1–50).
    - The client spaces requests 500 ms apart, which can't exceed 120 a minute; don't lower it.
    - The score multiplies: each product's fields count `first` times, and inside a product's `offers(first: O)` everything, `nodes` and `pageInfo` included, counts O times more. The formula and today's page sizes are in `carton-card-searcher.ts`; recompute them before adding a field.
    - A refused query comes back as a 200 with `errors`, not an HTTP error; `query()` turns it into a `ShopRequestError`.
    - `search` matches anywhere in the name and has no exact-match option, so short names ("Opt") take a few pages; exact matching is done in our code. There's no product-by-id query: a printing's full offers are searched again by its name within its set (`expansionSlug`).
- **Scryfall (name lookups) allows 2 requests a second on `/cards/named` and `/cards/collection`** ([rate limits](https://scryfall.com/docs/api/rate-limits)), shared by every user.
    - Most names never reach it: `CardIndex` (`src/server/search/card-index.ts`) looks them up first in `src/server/search/card-names.json`, built from Scryfall's oracle-cards bulk file. It answers only when exactly one card fits (exact name, the start of each word, a typo or two, or pieces of two or more words) and leaves the rest to the API: names in another language, ambiguous ones, and cards newer than the file. Refresh the file after each set release.
    - The index is the resolver's fourth argument; tests about the API leave it out.
    - `ScryfallNameResolver` keeps a client per endpoint, each spacing requests 500 ms apart. Don't lower it: a 429 limits access for 30 s, and ignoring 429s can get the app banned.
    - After a 429 every lookup stops for 60 s (`RATE_LIMIT_PAUSE_MS`) and names are searched as typed.
    - A search's first 2 cards come in a request of their own (`FIRST_REQUEST_CARDS` in `use-card-search.ts`): they are looked up by fuzzy name while the rest go in one collection request, and they are `urgent`, so batched shops send them without waiting for the batch window.
    - Tests must give the resolver fakes for both clients (its first and third arguments), or it calls the real API.
    - The collection client is created in `src/index.ts` (`scryfallClient()`) and shared with the traders' list prices (`ListPrices`), which pause between their own requests so lookups don't queue behind them. Don't give either its own client: two queues would double the rate.
    - `/cards/collection` finds a double-faced or split card by one face's name, never by the whole "A // B" (`{"name":"Fire // Ice"}` comes back in `not_found`). Ask by the front face.
- **Nerdik's batch API matches only a card's full name:** "Bonecrusher Giant // Stomp" finds it, "Bonecrusher Giant" finds nothing.
  The name resolver gives shops the front face, so searchers also get `fullName` (Scryfall's name for the whole card) as the third argument of `search()`; `NerdikCardSearcher` searches by it.
  `CachedCardSearcher` keys on both names.
- **Two Bun versions:** `bun-plugin-tailwind` pulls a project-local Bun into `node_modules` (1.4.4 today), and `bun run <script>` (`bun dev`, `bun start`, `bun run test:coverage`) uses it.
  A bare `bun …` uses the global install, which may be older. Behaviour and coverage numbers can differ between them; when in doubt, go through a script.
- **`Bun.serve`'s `idleTimeout` (in `src/index.ts`) must outlast the slowest shop.** The default 10 s dropped streams while Kartoteka was still searching.
- **The result cache is 10 minutes.** When testing parser changes against a running server, restart it, or you'll see cached results.
- **`bun --hot` (`bun dev`) re-runs `src/index.ts` on every change but keeps the old run's timers**, and the server has no `import.meta.hot` to dispose them. Schedule recurring work with in-process `Bun.cron`, which Bun stops before each reload (as the list refresher does); anything on `setInterval` must stop its predecessor itself.
- **`bun dev` reads the approved lists in your local database for real**, each night (and at start, if it starts at night). Seed a scratch `DB_PATH` for experiments rather than approving many lists locally.
- **On Windows, a backgrounded `bun dev` can report exiting while its `bun --hot` child keeps the port.** After a smoke test, stop whatever listens on the port and check it's free.
- **Frontend performance relies on stable `SearchResult` objects:**
    - `CardSection` is `memo`ized
    - `splitMatches` caches per result object in a `WeakMap`
    - replace results immutably, and never mutate a finished result
- **Single-column grids need `grid-cols-1` (`minmax(0, 1fr)`).** Otherwise the column grows to fit long content, like the collapsed card-list bar, and the whole page overflows.

## Scraping etiquette

- **Request rate:** keep it at or below today's (≥200 ms between requests per shop, the `ShopClient` default; at most 6 cards per client at each scraped shop at once, `CARDS_PER_SHOP` in `src/index.ts`; batched shops take a whole request's list, `MAX_CARDS_PER_REQUEST`, since it goes out in few requests).
- **Bot challenges:** some shop pages sit behind one, like Kartoteka's product pages and Nerdik's site search (we use Nerdik's API instead). Work from the pages that don't, rather than trying to get around the challenge.
- **Live testing:** a few searches at most; don't loop over many cards against the real shops.
- **The one exception, Moxfield (temporary):** its firewall answers unapproved clients with a 403, and we get through by sending Postman's User-Agent (`LIST_SOURCES.moxfield.headers` in `list-link.ts`). The owner chose this knowingly, to try Moxfield lists out while asking Moxfield for API access. Don't copy it for any other site. Once Moxfield grants access, replace the header with the User-Agent they give us; if they refuse, remove Moxfield. If they close the gap first, every Moxfield list fails its refresh as `unavailable`.
