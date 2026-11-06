import { serve } from "bun";
import index from "./index.html";
import { parseCarton, parseGin, parseManavault, parseNerdik } from "./parsers";
import { normalize, type CardResult, type SearchResult, type ShopId } from "./shops";

const SHOPS:{ name: ShopId; searchUrl: string; parse: (html: string) => CardResult[] }[] = [
  { name: "gin", searchUrl: "https://mtgin.kyiv.ua/", parse: parseGin },
  { name: "carton", searchUrl: "https://carton.cards/search", parse: parseCarton },
  { name: "manavault", searchUrl: "https://manavaultstore.com/cards", parse: parseManavault },
  { name: "nerdik", searchUrl: "https://nerdik.club/katalog/search/", parse: parseNerdik },
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
            const q = new URLSearchParams({ q: card }).toString();
            const shops = await Promise.all(
              SHOPS.map(async shop => {
                try {
                  const res = await fetch(`${shop.searchUrl}?${q}`);
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  return { links: shop.parse(await res.text()), error: null };
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
