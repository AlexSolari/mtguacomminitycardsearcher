import { normalize } from '../matching';
import type { CardResult, SearchError, SearchResult } from '../search-result';
import type { ShopId } from '../shops';
import type { CardSearcher } from './card-searcher';
import { logger } from './logger';
import { HttpError } from './shop-client';

type ShopOutcome = { links: CardResult[]; error: SearchError | null };

// Searches every shop for a card. A failing shop doesn't fail the card — it's reported in `errors`.
// `signal` is the client's request: when it disconnects, the search rejects and its queued shop requests are dropped.
// One slow shop (Kartoteka) mustn't hold back the others, so `onUpdate` gets the result so far each time a shop
// finishes while others are still searching (`pending` lists them); the returned promise is the complete result.
export class CardSearchService {
    constructor(private readonly searchers: CardSearcher[]) {}

    async search(
        card: string,
        signal?: AbortSignal,
        onUpdate?: (partial: SearchResult) => void
    ): Promise<SearchResult> {
        // in searcher order, so links and errors keep the same order however the shops finish
        const outcomes: (ShopOutcome | undefined)[] = this.searchers.map(
            () => undefined
        );
        let remaining = this.searchers.length;
        await Promise.all(
            this.searchers.map(async (searcher, i) => {
                outcomes[i] = await this.searchShop(searcher, card, signal);
                if (--remaining > 0 && onUpdate && !signal?.aborted)
                    onUpdate(this.snapshot(card, outcomes));
            })
        );
        return this.snapshot(card, outcomes);
    }

    private async searchShop(
        searcher: CardSearcher,
        card: string,
        signal?: AbortSignal
    ): Promise<ShopOutcome> {
        try {
            return { links: await searcher.search(card, signal), error: null };
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
                    status: err instanceof HttpError ? err.status : undefined
                }
            };
        }
    }

    private snapshot(
        card: string,
        outcomes: (ShopOutcome | undefined)[]
    ): SearchResult {
        const done = outcomes.filter((o): o is ShopOutcome => !!o);
        const pending: ShopId[] = this.searchers
            .filter((_, i) => !outcomes[i])
            .map((s) => s.shop);
        // Shop searches are fuzzy (e.g. "sol ring" also hits "Soldier of the Grey Host") — keep only names containing the query.
        const query = normalize(card);
        return {
            card,
            links: done
                .flatMap((s) => s.links)
                .filter((l) => normalize(l.name).includes(query)),
            errors: done.flatMap((s) => (s.error ? [s.error] : [])),
            ...(pending.length > 0 && { pending })
        };
    }
}
