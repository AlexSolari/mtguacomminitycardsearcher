import type { CardResult } from '../search-result';
import type { ShopId } from '../shops';
import { logger } from './logger';

// Searches one shop for a card. Implementations own a ShopClient, which rate-limits requests to their shop.
// `signal` aborts when nobody wants the result any more; pass it to every client call so the requests leave the
// shop's queue.
// `card` is the name to search for (for a double-faced card, the face shops list it under). `fullName` is the whole
// card's name ("Bonecrusher Giant // Stomp", see ResolvedName); it defaults to `card`, and only searchers whose API
// matches full names exactly need it.
// `batched` searchers send many cards per request (see Batcher), so they should get a whole list at once rather than
// a few cards at a time (see the route's per-shop limits).
export interface CardSearcher {
    readonly shop: ShopId;
    readonly batched?: boolean;
    // `urgent`: one of a search's first cards; batched searchers send it without waiting for their batch window
    search(
        card: string,
        signal?: AbortSignal,
        fullName?: string,
        urgent?: boolean
    ): Promise<CardResult[]>;
}

// For scrapers: an empty parse usually just means "not in stock", but it's also what a shop redesign looks like:
// the parser finds none of the markup it expects. Log it, so a broken parser shows up as a run of these in the logs.
// API searchers don't use it: an empty API response is an ordinary "not in stock", and logging every one is noise.
export function warnIfEmpty(shop: ShopId, url: string, results: CardResult[]) {
    if (results.length === 0)
        logger.warn('parser found nothing', { shop, url });
    return results;
}

// For optional follow-up requests whose failure falls back to what the search already found: the card isn't
// failed, but the reason is still logged (a 429 or timeout here is worth knowing about). An aborted search isn't
// a failure, so it's rethrown rather than logged.
export function warnFallback(
    shop: ShopId,
    url: string,
    err: unknown,
    signal?: AbortSignal
) {
    if (signal?.aborted) throw err;
    logger.warn('follow-up request failed, keeping search results', {
        shop,
        url,
        error: err
    });
}
