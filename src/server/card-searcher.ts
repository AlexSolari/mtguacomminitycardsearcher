import type { CardResult, ShopId } from '../shops';
import { HttpError } from './shop-client';

// Searches one shop for a card. Implementations own a ShopClient, which rate-limits requests to their shop.
// `signal` aborts when nobody wants the result any more; pass it to every client call so the requests leave the
// shop's queue.
export interface CardSearcher {
    readonly shop: ShopId;
    search(card: string, signal?: AbortSignal): Promise<CardResult[]>;
}

// An empty parse usually just means "not in stock", but it's also what a shop redesign looks like: the parser
// finds none of the markup it expects. Log it, so a broken parser shows up as a run of these in the logs.
export function warnIfEmpty(shop: ShopId, url: string, results: CardResult[]) {
    if (results.length === 0)
        console.warn(`[${shop}] parser found nothing at ${url}`);
    return results;
}

// For optional follow-up requests whose failure falls back to what the search already found: the card isn't
// failed, but the reason is still logged (a 429 or timeout here is worth knowing about). A 404 is expected
// when `expect404` is set, and an aborted search isn't a failure, so neither is logged.
export function warnFallback(
    shop: ShopId,
    url: string,
    err: unknown,
    signal?: AbortSignal,
    { expect404 = false } = {}
) {
    if (signal?.aborted) throw err;
    if (expect404 && err instanceof HttpError && err.status === 404) return;
    console.warn(
        `[${shop}] ${url} failed, keeping search results:`,
        (err as Error).message
    );
}
