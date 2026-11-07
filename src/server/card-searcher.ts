import type { CardResult, ShopId } from '../shops';

// Searches one shop for a card. Implementations own a ShopClient, which rate-limits requests to their shop.
export interface CardSearcher {
    readonly shop: ShopId;
    search(card: string): Promise<CardResult[]>;
}

// An empty parse usually just means "not in stock", but it's also what a shop redesign looks like: the parser
// finds none of the markup it expects. Log it, so a broken parser shows up as a run of these in the logs.
export function warnIfEmpty(shop: ShopId, url: string, results: CardResult[]) {
    if (results.length === 0)
        console.warn(`[${shop}] parser found nothing at ${url}`);
    return results;
}
