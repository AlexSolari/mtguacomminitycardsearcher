import { serve } from 'bun';
import index from './index.html';
import { CardSearchService } from './server/card-search-service';
import { ShopClient } from './server/shop-client';
import { CartonCardSearcher } from './server/searchers/carton-card-searcher';
import { GinCardSearcher } from './server/searchers/gin-card-searcher';
import { KartotekaCardSearcher } from './server/searchers/kartoteka-card-searcher';
import { ManavaultCardSearcher } from './server/searchers/manavault-card-searcher';
import { NerdikCardSearcher } from './server/searchers/nerdik-card-searcher';
import { PaytowinCardSearcher } from './server/searchers/paytowin-card-searcher';

const shopClient = new ShopClient();
const cardSearch = new CardSearchService([
    new GinCardSearcher(shopClient),
    new CartonCardSearcher(shopClient),
    new ManavaultCardSearcher(shopClient),
    new NerdikCardSearcher(shopClient),
    new KartotekaCardSearcher(shopClient),
    new PaytowinCardSearcher(shopClient)
]);

const server = serve({
    routes: {
        // Serve index.html for all unmatched routes.
        '/*': index,

        '/api/search': {
            async POST(req) {
                const body = (await req.json().catch(() => null)) as {
                    cards?: string[];
                } | null;
                const cards = Array.isArray(body?.cards) ? body.cards : [];
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
