import { serve, type Server } from 'bun';
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
import { normalize } from './matching';

// The frontend sends one card per request; this only bounds what a hand-made request can queue up.
const MAX_CARDS_PER_REQUEST = 100;

// Cards one client may have searching at once, across all its requests; the rest wait for a slot. The frontend
// keeps 6 in flight per tab, so one tab never waits, and a second tab (or a shared IP) only slows down.
const MAX_CARDS_IN_FLIGHT = 12;
const limiter = new InFlightLimiter(MAX_CARDS_IN_FLIGHT);

// Behind a proxy (Railway) every connection comes from the proxy, so the client is the address the proxy
// appended last to X-Forwarded-For. Earlier entries are whatever the client sent, so they can't be trusted.
function clientId(req: Request, server: Server<unknown>) {
    const forwarded = req.headers.get('x-forwarded-for');
    const last = forwarded?.split(',').at(-1)?.trim();
    return last || server.requestIP(req)?.address || 'unknown';
}

// A long list logs only its first few names; `count` has the rest.
const LOGGED_NAMES = 5;

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

const server = serve({
    routes: {
        // Serve index.html for all unmatched routes.
        '/*': index,

        // ...except API paths, where a typo should fail loudly instead of returning the page
        '/api/*': () => Response.json({ error: 'Not found' }, { status: 404 }),

        '/api/search': {
            async POST(req, server) {
                const body = (await req.json().catch(() => null)) as {
                    cards?: unknown[];
                } | null;
                // drop non-strings and names with nothing searchable ("!!!" would otherwise match every listing)
                const cards = (Array.isArray(body?.cards) ? body.cards : [])
                    .filter((c): c is string => typeof c === 'string')
                    .map((c) => c.trim())
                    .filter((c) => normalize(c) !== '');
                logger.info('search', {
                    cards: cards.slice(0, LOGGED_NAMES),
                    count: cards.length
                });
                if (cards.length > MAX_CARDS_PER_REQUEST)
                    return Response.json(
                        {
                            error: `Too many cards (max ${MAX_CARDS_PER_REQUEST})`
                        },
                        { status: 400 }
                    );
                // each card fans out to every shop — one client's cards take turns instead of flooding them
                const client = clientId(req, server);
                try {
                    // req.signal aborts when the client disconnects (closed tab, a new search)
                    const results = await Promise.all(
                        cards.map((card) =>
                            limiter.run(
                                client,
                                () => cardSearch.search(card, req.signal),
                                req.signal
                            )
                        )
                    );
                    return Response.json({ results });
                } catch (err) {
                    if (req.signal.aborted)
                        return new Response(null, { status: 499 });
                    throw err;
                }
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

logger.info('server started', { url: server.url.href });
