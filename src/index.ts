import { serve } from 'bun';
import index from './index.html';
import { CachedCardSearcher } from './server/cached-card-searcher';
import { CardIndex } from './server/card-index';
import { CardSearchService } from './server/card-search-service';
import { InFlightLimiter } from './server/in-flight-limiter';
import { logger } from './server/logger';
import { ScryfallNameResolver } from './server/name-resolver';
import { CartonCardSearcher } from './server/searchers/carton-card-searcher';
import { CitadelCardSearcher } from './server/searchers/citadel-card-searcher';
import { GinCardSearcher } from './server/searchers/gin-card-searcher';
import { KartotekaCardSearcher } from './server/searchers/kartoteka-card-searcher';
import { MagicswampCardSearcher } from './server/searchers/magicswamp-card-searcher';
import { ManavaultCardSearcher } from './server/searchers/manavault-card-searcher';
import { NerdikCardSearcher } from './server/searchers/nerdik-card-searcher';
import { PaytowinCardSearcher } from './server/searchers/paytowin-card-searcher';
import { clickHandler } from './server/click-route';
import {
    clientId,
    MAX_CARDS_PER_REQUEST,
    searchHandler
} from './server/search-route';
import { VisitorIds } from './server/visitor-id';
import { adminIds, authHandlers } from './server/auth/auth-route';
import {
    TelegramLogin,
    telegramLoginConfig
} from './server/auth/telegram-login';
import { databasePath, openDatabase } from './server/db/database';
import { UserStore } from './server/db/user-store';
import { ListStore } from './server/db/list-store';
import { listsHandlers } from './server/lists-route';

// Cards one client may have at one shop at once (see ShopLimits). 6 is what one browser tab had in flight when it
// sent a card per request, so no shop gets more of a client's requests at once than before.
const CARDS_PER_SHOP = 6;

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
// Card names known without asking Scryfall (scripts/update-card-names.ts); the rest are looked up on its API.
const cardNames = await CardIndex.load();
logger.info('card name index loaded', {
    cards: cardNames.cards,
    source: cardNames.source
});

// one salt for both routes, so a visitor's searches and clicks share an id
const visitors = new VisitorIds();
const search = searchHandler(
    cardSearch,
    {
        shops: new InFlightLimiter(CARDS_PER_SHOP),
        // a whole request's list, so it goes out in as few batches as it can
        batched: new InFlightLimiter(MAX_CARDS_PER_REQUEST)
    },
    new ScryfallNameResolver(undefined, undefined, undefined, cardNames.index),
    visitors
);
const click = clickHandler(visitors);

// Traders and their lists (see server/db/). Sign-in is off until the Telegram bot's details are set.
const db = openDatabase(databasePath());
const loginConfig = telegramLoginConfig();
if (!loginConfig)
    logger.info('telegram sign-in is off', {
        reason: 'TELEGRAM_CLIENT_ID or TELEGRAM_CLIENT_SECRET is not set'
    });
const users = new UserStore(db);
const auth = authHandlers(
    users,
    loginConfig && new TelegramLogin(loginConfig),
    adminIds()
);
const lists = listsHandlers(new ListStore(db), users, auth);

const server = serve({
    // Bun drops a connection after 10 s without a byte (the default), and a search stays quiet while its slowest
    // shop works: up to 30 s in the shop's queue plus a 15 s timeout per request, and some searches make a few in
    // a row (CartOn's product pages). The shop timeouts are what bound a search; this only mustn't cut in first.
    idleTimeout: 120,

    routes: {
        // Serve index.html for all unmatched routes.
        '/*': index,

        // ...except API paths, where a typo should fail loudly instead of returning the page
        '/api/*': () => Response.json({ error: 'Not found' }, { status: 404 }),

        // the link preview image that index.html's og:image points at
        '/og-image.png': new Response(
            await Bun.file(new URL('./og-image.png', import.meta.url)).bytes(),
            {
                headers: {
                    'Content-Type': 'image/png',
                    'Cache-Control': 'public, max-age=86400'
                }
            }
        ),

        '/api/search': {
            POST: (req, server) =>
                search(req, clientId(req, server.requestIP(req)?.address))
        },

        '/api/click': {
            POST: (req, server) =>
                click(req, clientId(req, server.requestIP(req)?.address))
        },

        '/api/auth/login': { GET: () => auth.login() },
        '/api/auth/callback': { GET: (req) => auth.callback(req) },
        '/api/auth/me': { GET: (req) => auth.me(req) },
        '/api/auth/logout': { POST: (req) => auth.logout(req) },

        '/api/lists': {
            GET: (req) => lists.mine(req),
            POST: (req) => lists.submit(req)
        },
        '/api/lists/:id': {
            DELETE: (req) => lists.remove(req, req.params.id)
        },
        '/api/admin/lists': { GET: (req) => lists.queue(req) },
        '/api/admin/lists/:id': {
            POST: (req) => lists.review(req, req.params.id)
        },
        '/api/admin/users/:id': {
            POST: (req) => lists.ban(req, req.params.id)
        }
    },

    // A throw that escapes a route handler; logging it as an error also reports it to Sentry
    error(error) {
        logger.error('request failed', { error });
        return Response.json({ error: 'Internal error' }, { status: 500 });
    },

    development: process.env.NODE_ENV !== 'production' && {
        // Enable browser hot reloading in development
        hmr: true,

        // Echo console logs from the browser to the server
        console: true
    }
});

logger.info('server started', { url: server.url.href });
