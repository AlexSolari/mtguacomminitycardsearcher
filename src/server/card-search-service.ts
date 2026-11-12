import { normalize } from '../matching';
import type { CardResult, SearchError, SearchResult } from '../search-result';
import type { ShopId } from '../shops';
import type { CardSearcher } from './card-searcher';
import { logger } from './logger';
import { HttpError } from './shop-client';

type ShopOutcome = { links: CardResult[]; error: SearchError | null };

// Runs one shop search for a card when the caller allows it: the route uses it to cap how many cards each client has
// at each shop at once.
export type ShopLimit = (
    searcher: CardSearcher,
    run: () => Promise<CardResult[]>
) => Promise<CardResult[]>;

// Searches every shop for a card. A failing shop doesn't fail the card — it's reported in `errors`.
// `signal` is the client's request: when it disconnects, the search rejects and its queued shop requests are dropped.
// One slow shop (Kartoteka) mustn't hold back the others, so `onUpdate` gets the result so far each time a shop
// finishes while others are still searching (`pending` lists them); the returned promise is the complete result.
// `fullName` goes to the searchers that need it (see CardSearcher). `limit`, when given, runs each shop search.
export class CardSearchService {
    constructor(private readonly searchers: CardSearcher[]) {}

    async search(
        card: string,
        signal?: AbortSignal,
        onUpdate?: (partial: SearchResult) => void,
        fullName = card,
        limit: ShopLimit = (_, run) => run(),
        urgent = false
    ): Promise<SearchResult> {
        // in searcher order, so links and errors keep the same order however the shops finish
        const outcomes: (ShopOutcome | undefined)[] = this.searchers.map(
            () => undefined
        );
        let remaining = this.searchers.length;
        await Promise.all(
            this.searchers.map(async (searcher, i) => {
                outcomes[i] = await this.searchShop(
                    searcher,
                    card,
                    fullName,
                    limit,
                    signal,
                    urgent
                );
                if (--remaining > 0 && onUpdate && !signal?.aborted)
                    onUpdate(this.snapshot(card, outcomes));
            })
        );
        return this.snapshot(card, outcomes);
    }

    private async searchShop(
        searcher: CardSearcher,
        card: string,
        fullName: string,
        limit: ShopLimit,
        signal?: AbortSignal,
        urgent = false
    ): Promise<ShopOutcome> {
        try {
            return {
                links: await limit(searcher, () =>
                    searcher.search(card, signal, fullName, urgent)
                ),
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
