import { ShopClient } from '@/server/outbound/shop-client';

// Scryfall rejects requests without these
export const SCRYFALL_HEADERS = {
    'User-Agent': 'searcher/0.1',
    Accept: 'application/json'
};

// Each endpoint allows 2 requests a second, shared by every user (see ScryfallNameResolver); 500 ms apart stays
// within it. Don't lower it: a 429 limits access for 30 s.
export function scryfallClient() {
    return new ShopClient('https://api.scryfall.com', {
        intervalMs: 500,
        timeoutMs: 5_000,
        maxWaitMs: 5_000
    });
}
