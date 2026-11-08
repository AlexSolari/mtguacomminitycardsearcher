import { serve } from 'bun';
import index from './index.html';
import { CachedCardSearcher } from './server/cached-card-searcher';
import { CardSearchService } from './server/card-search-service';
import { InFlightLimiter } from './server/in-flight-limiter';
import { logger } from './server/logger';
import { CartonCardSearcher } from './server/searchers/carton-card-searcher';
import { CitadelCardSearcher } from './server/searchers/citadel-card-searcher';
import { GinCardSearcher } from './server/searchers/gin-card-searcher';
import { KartotekaCardSearcher } from './server/searchers/kartoteka-card-searcher';
import { MagicswampCardSearcher } from './server/searchers/magicswamp-card-searcher';
import { ManavaultCardSearcher } from './server/searchers/manavault-card-searcher';
import { NerdikCardSearcher } from './server/searchers/nerdik-card-searcher';
import { PaytowinCardSearcher } from './server/searchers/paytowin-card-searcher';
import { clientId, searchHandler } from './server/search-route';

// Cards one client may have searching at once, across all its requests; the rest wait for a slot. The frontend
// keeps 6 in flight per tab, so one tab never waits, and a second tab (or a shared IP) only slows down.
const MAX_CARDS_IN_FLIGHT = 12;

// Each searcher creates its own ShopClient, so each shop has its own rate limit and request queue.
const cardSearch = new CardSearchService(
    [
        new GinCardSearcher(),
        new CartonCardSearcher(),
        new ManavaultCardSearcher(),
        new NerdikCardSearcher(),
        new KartotekaCardSearcher(),
        new PaytowinCardSearcher(),
        new MagicswampCardSearcher(),
        new CitadelCardSearcher()
    ].map((searcher) => new CachedCardSearcher(searcher))
);
const search = searchHandler(
    cardSearch,
    new InFlightLimiter(MAX_CARDS_IN_FLIGHT)
);

const server = serve({
    routes: {
        // Serve index.html for all unmatched routes.
        '/*': index,

        // ...except API paths, where a typo should fail loudly instead of returning the page
        '/api/*': () => Response.json({ error: 'Not found' }, { status: 404 }),

        '/api/search': {
            POST: (req, server) =>
                search(req, clientId(req, server.requestIP(req)?.address))
        }
    },

    development: process.env.NODE_ENV !== 'production' && {
        // Enable browser hot reloading in development
        hmr: true,

        // Echo console logs from the browser to the server
        console: true
    }
});

logger.info('server started', { url: server.url.href });
