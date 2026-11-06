import { serve } from 'bun';
import index from './index.html';
import { CachedCardSearcher } from './server/cached-card-searcher';
import { CardSearchService } from './server/card-search-service';
import { ShopClient } from './server/shop-client';
import { CartonCardSearcher } from './server/searchers/carton-card-searcher';
import { GinCardSearcher } from './server/searchers/gin-card-searcher';
import { KartotekaCardSearcher } from './server/searchers/kartoteka-card-searcher';
import { ManavaultCardSearcher } from './server/searchers/manavault-card-searcher';
import { NerdikCardSearcher } from './server/searchers/nerdik-card-searcher';
import { PaytowinCardSearcher } from './server/searchers/paytowin-card-searcher';
import { normalize } from './shops';

// The frontend sends one card per request; this only bounds what a hand-made request can trigger.
const MAX_CARDS_PER_REQUEST = 100;

const shopClient = new ShopClient();
const cardSearch = new CardSearchService(
    [
        new GinCardSearcher(shopClient),
        new CartonCardSearcher(shopClient),
        new ManavaultCardSearcher(shopClient),
        new NerdikCardSearcher(shopClient),
        new KartotekaCardSearcher(shopClient),
        new PaytowinCardSearcher(shopClient)
    ].map((searcher) => new CachedCardSearcher(searcher))
);

const server = serve({
    routes: {
        // Serve index.html for all unmatched routes.
        '/*': index,

        '/api/search': {
            async POST(req) {
                const body = (await req.json().catch(() => null)) as {
                    cards?: unknown[];
                } | null;
                // drop non-strings and names with nothing searchable ("!!!" would otherwise match every listing)
                const cards = (Array.isArray(body?.cards) ? body.cards : [])
                    .filter((c): c is string => typeof c === 'string')
                    .map((c) => c.trim())
                    .filter((c) => normalize(c) !== '');
                // each card fans out to every shop — don't let one request flood them
                if (cards.length > MAX_CARDS_PER_REQUEST)
                    return Response.json(
                        {
                            error: `Too many cards (max ${MAX_CARDS_PER_REQUEST})`
                        },
                        { status: 400 }
                    );
                return Response.json({
                    results: await cardSearch.search(cards)
                });
            }
        }
    },

    development: process.env.NODE_ENV !== 'production' && {
        // Enable browser hot reloading in development
        hmr: true,

        // Echo console logs from the browser to the server
        console: true
    }
});

console.log(`🚀 Server running at ${server.url}`);
