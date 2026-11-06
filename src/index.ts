import { serve } from "bun";
import index from "./index.html";
import {
  parseCarton,
  parseGin,
  parseGinPrintings,
  parseKartoteka,
  parseManavault,
  parseManavaultVersions,
  parseNerdik,
  parsePaytowin,
} from "./parsers";
import { isExactMatch, normalize, type CardResult, type SearchResult, type ShopId } from "./shops";

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const searchBy = (searchUrl: string, parse: (html: string) => CardResult[]) => async (card: string) =>
  parse(await fetchHtml(`${searchUrl}?${new URLSearchParams({ q: card })}`));

// Mana Vault's search returns one tile per card. For exact matches, swap it for the card's versions page, which
// lists every in-stock printing with its own price. That page wants the exact, case-sensitive full name
// ("Daze", "Emeritus of Woe // Demonic Tutor"), so we take names from the search results — plus the query as typed.
async function searchManavault(card: string): Promise<CardResult[]> {
  const found = await searchBy("https://manavaultstore.com/cards", parseManavault)(card);
  const exact = found.filter(l => isExactMatch(l.name, card));
  const names = [...new Set([card, ...exact.map(l => l.name)])];

  const versions = await Promise.all(
    names.map(name =>
      fetchHtml(`https://manavaultstore.com/cards/versions?${new URLSearchParams({ name })}`)
        .then(parseManavaultVersions)
        .catch(() => null), // 404 = no card by that exact name
    ),
  );
  const printings = versions.flatMap(v => v ?? []);
  if (printings.length === 0) return found; // versions lookup failed / nothing in stock there — keep search results

  const byUrl = new Map(printings.map(p => [p.url, p]));
  for (const l of found) if (!isExactMatch(l.name, card)) byUrl.set(l.url, l); // keep fuzzy "other matches"
  return [...byUrl.values()];
}

// MTGin's search shows one summary tile per card when it has several printings ("4 версії · від 42 ₴"), linking to
// /cards/oracle/<id>. For exact matches, expand that page into one result per printing (and seller), like Mana Vault.
// If the expansion fails or comes back empty, the summary tile stays.
async function searchGin(card: string): Promise<CardResult[]> {
  const found = await searchBy("https://mtgin.kyiv.ua/", parseGin)(card);
  const expanded = await Promise.all(
    found.map(async l => {
      if (!l.printings || !isExactMatch(l.name, card)) return [l];
      try {
        const printings = parseGinPrintings(await fetchHtml(l.url));
        return printings.length > 0 ? printings : [l];
      } catch {
        return [l];
      }
    }),
  );
  return expanded.flat();
}

const SHOPS:{ name: ShopId; search: (card: string) => Promise<CardResult[]> }[] = [
  { name: "gin", search: searchGin },
  { name: "carton", search: searchBy("https://carton.cards/search", parseCarton) },
  { name: "manavault", search: searchManavault },
  { name: "nerdik", search: searchBy("https://nerdik.club/katalog/search/", parseNerdik) },
  { name: "kartoteka", search: searchBy("https://kartoteka.in.ua/ua/search/", parseKartoteka) },
  {
    name: "paytowin",
    search: async card => {
      const res = await fetch(`https://api.paytowin.club/auctions?${new URLSearchParams({ q: card, game: "magic", limit: "50" })}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parsePaytowin(await res.json());
    },
  },
];

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/search": {
      async POST(req) {
        const body = (await req.json().catch(() => null)) as { cards?: string[] } | null;
        const cards = Array.isArray(body?.cards) ? body.cards : [];

        const results = await Promise.all(
          cards.map(async (card): Promise<SearchResult> => {
            const shops = await Promise.all(
              SHOPS.map(async shop => {
                try {
                  return { links: await shop.search(card), error: null };
                } catch (err) {
                  console.error(`[${shop.name}] search for "${card}" failed:`, err);
                  return { links: [], error: `${shop.name}: ${(err as Error).message}` };
                }
              }),
            );
            // Shop searches are fuzzy (e.g. "sol ring" also hits "Soldier of the Grey Host") — keep only names containing the query.
            const query = normalize(card);
            return {
              card,
              links: shops.flatMap(s => s.links).filter(l => normalize(l.name).includes(query)),
              errors: shops.flatMap(s => (s.error ? [s.error] : [])),
            };
          }),
        );

        return Response.json({ results });
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
