import type { CardResult } from '../search-result';
import type { ShopId } from '../shops';
import { logger } from './logger';

// Searches one shop for a card. Implementations own a ShopClient, which rate-limits requests to their shop.
// `signal` aborts when nobody wants the result any more; pass it to every client call so the requests leave the
// shop's queue.
// `card` is the name to search for (for a double-faced card, the face shops list it under). `fullName` is the whole
// card's name ("Bonecrusher Giant // Stomp", see ResolvedName); it defaults to `card`, and only searchers whose API
// matches full names exactly need it.
export interface CardSearcher {
    readonly shop: ShopId;
    search(
        card: string,
        signal?: AbortSignal,
        fullName?: string
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

// Product pages fetched per search at most. Each costs a request; Sol Ring has 15 printings in stock at CartOn
// alone, and a few such cards in flight would push the shop's queue past its wait limit.
export const MAX_PRODUCT_PAGES = 10;

// For scrapers whose search lists one tile per printing with only its cheapest price: swaps the tiles that
// `canExpand` picks, the cheapest MAX_PRODUCT_PAGES of them, for the offers on each one's own page (`offers`
// fetches and parses it). A tile whose page fails or lists no offers stays as it is, and so does every other
// tile. The results keep the tiles' order.
export async function expandCheapest(
    shop: ShopId,
    tiles: CardResult[],
    canExpand: (tile: CardResult) => boolean,
    offers: (tile: CardResult) => Promise<CardResult[]>,
    signal?: AbortSignal
): Promise<CardResult[]> {
    const expand = new Set(
        tiles
            .filter(canExpand)
            .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
            .slice(0, MAX_PRODUCT_PAGES)
    );
    const results = await Promise.all(
        tiles.map(async (tile) => {
            if (!expand.has(tile)) return [tile];
            try {
                const found = warnIfEmpty(shop, tile.url, await offers(tile));
                return found.length > 0 ? found : [tile];
            } catch (err) {
                warnFallback(shop, tile.url, err, signal);
                return [tile];
            }
        })
    );
    return results.flat();
}
