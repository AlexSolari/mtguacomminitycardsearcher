# AGENTS.md

Price comparison for Magic: The Gathering singles across Ukrainian online shops.
It's a Bun server that scrapes shop search pages, with a React 19 + Tailwind v4 frontend; the UI text is Ukrainian.
See [README.md](README.md) for what the app does and the request flow.

## Commands

| Task                                                 | Command                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Dev server (hot reload, port 3000, `PORT` overrides) | `bun dev`                                                                           |
| Production server                                    | `bun start`                                                                         |
| Type-check                                           | `bunx tsc --noEmit`                                                                 |
| Format                                               | `bun run format` (or `bunx prettier --write <files>`)                               |
| Static frontend bundle                               | `bun run build -- --outdir=<dir>` (defaults to `dist/`, which it **deletes first**) |

**Type-check baseline:** `tsc` always reports about 7 errors in `build.ts`, which come from the Bun template.
Anything else is yours.

**No tests:** there is no test suite.

- **Parsers and matching:** verify with a throwaway script that imports the function and runs it on sample input. Put it outside the repo.
- **Server:** start it on a spare port (`PORT=3917 bun src/index.ts`) and `curl -X POST localhost:3917/api/search -d '{"cards":["Sol Ring"]}'`.
  This hits the real shops, so keep it to a handful of requests.
- **UI:** say so when a change hasn't been checked in a browser.

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
- **Files:** kebab-case file names. Components go in `src/components/`, hooks in `src/hooks/`, shadcn primitives in `src/components/ui/`.
- **Icons:** lucide-react, except brand logos. lucide is removing those, so they're inline SVGs in `components/icons.tsx`.

## Architecture rules

- **`src/shops.ts` is shared with the browser:** it must not import anything server-only.
  It holds `CardResult`, `SHOP_INFO`, `normalize` and `isExactMatch`.
- **Parsers** (`src/server/parsers/<shop>.ts`) are pure: string/JSON in, `CardResult[]` out, no fetching.
  Shared helpers (`decodeEntities`, `parsePrice`, `abs`, Next.js flight-data readers) live in `parsers/helpers.ts`.
- **Searchers** (`src/server/searchers/<shop>-card-searcher.ts`) decide which URLs to fetch and call the parsers.
  They **must** fetch through the shared `ShopClient`, never `fetch` directly; it provides the per-host rate limit and timeout.
- **Wiring:** searchers are registered in `src/index.ts`, each wrapped in `CachedCardSearcher`.
- **Prices:**
    - `price` is in UAH, or `null` when unknown; never `0` for "unknown"
    - set `fromPrice` when the price is the cheapest of several offers
    - auctions set `auction`, and their price never counts toward best price or totals

### Adding a shop

1. **Shop info:** add its id to `ShopId` and an entry to `SHOP_INFO` in `src/shops.ts` (label, homepage, favicon).
2. **Parser:** write `src/server/parsers/<shop>.ts`. Start with a comment showing the markup or JSON shape it reads.
    - Fill the optional `CardResult` fields the shop exposes: foil, language, stock, condition, old price.
    - Drop out-of-stock items unless the shop only lists in-stock ones.
3. **Searcher:** write `src/server/searchers/<shop>-card-searcher.ts`, following an existing one.
4. **Register it:** add it to the list in `src/index.ts`.
5. **Check:** test the parser on a saved page and run one live search.

## Traps (each of these has bitten before)

- **Name matching goes through `normalize`:** it lower-cases, strips diacritics and expands `æ`.
  Use `isExactMatch` / `normalize` for every name comparison, never raw string equality.
  "Æther Vial" vs "Aether Vial" and "Lim-Dûl" vs "Lim-Dul" both depend on it.
- **`parsePrice` returns `null` when there are no digits.** Don't "simplify" it back to `Number(...)`: that turns "—" into 0 ₴, which then wins best price.
- **Decimal prices:** `"1 234,50"` parses as 123450. No shop shows kopecks today. Handle it per shop if one starts.
- **Mana Vault's versions page needs the exact, case-sensitive card name.** The typed query is only used when the search found no exact tile.
- **MTGin summary tiles:** a tile with `printings > 1` is a summary. For exact matches, the searcher expands it via the card's printings page.
- **The result cache is 5 minutes.** When testing parser changes against a running server, restart it, or you'll see cached results.
- **Frontend performance relies on stable `SearchResult` objects:**
    - `CardSection` is `memo`ized
    - `splitMatches` caches per result object in a `WeakMap`
    - replace results immutably, and never mutate a finished result
- **Single-column grids need `grid-cols-1` (`minmax(0, 1fr)`).** Otherwise the column grows to fit long content, like the collapsed card-list bar, and the whole page overflows.

## Scraping etiquette

- **Request rate:** keep it at or below today's (≥200 ms between requests per host).
- **Bot challenges:** some shop pages sit behind one, like Kartoteka's product pages and Nerdik's "in stock" filter URL. Work from the pages that don't, rather than trying to get around the challenge.
- **Live testing:** a few searches at most; don't loop over many cards against the real shops.
