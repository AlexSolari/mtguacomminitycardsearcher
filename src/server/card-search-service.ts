import { normalize } from '../matching';
import type { SearchResult } from '../search-result';
import type { CardSearcher } from './card-searcher';
import { logger } from './logger';
import { HttpError } from './shop-client';

// Searches every shop for a card. A failing shop doesn't fail the card — it's reported in `errors`.
// `signal` is the client's request: when it disconnects, the search rejects and its queued shop requests are dropped.
export class CardSearchService {
    constructor(private readonly searchers: CardSearcher[]) {}

    async search(card: string, signal?: AbortSignal): Promise<SearchResult> {
        const shops = await Promise.all(
            this.searchers.map(async (searcher) => {
                try {
                    return {
                        links: await searcher.search(card, signal),
                        error: null
                    };
                } catch (err) {
                    if (signal?.aborted) throw err;
                    logger.error('shop search failed', {
                        shop: searcher.shop,
                        card,
                        error: err
                    });
                    return {
                        links: [],
                        error: {
                            shop: searcher.shop,
                            message: (err as Error).message,
                            status:
                                err instanceof HttpError
                                    ? err.status
                                    : undefined
                        }
                    };
                }
            })
        );
        // Shop searches are fuzzy (e.g. "sol ring" also hits "Soldier of the Grey Host") — keep only names containing the query.
        const query = normalize(card);
        return {
            card,
            links: shops
                .flatMap((s) => s.links)
                .filter((l) => normalize(l.name).includes(query)),
            errors: shops.flatMap((s) => (s.error ? [s.error] : []))
        };
    }
}
