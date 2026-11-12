import { parseManavault, type ManavaultAnswer } from '../parsers/api/manavault';
import type { CardResult } from '../../search-result';
import { Batcher } from '../batcher';
import type { CardSearcher } from '../card-searcher';
import { HttpError, ShopClient, ShopRequestError } from '../shop-client';
import { WindowBudget } from '../window-budget';

// The API takes up to 50 names per request; every 10 names count as one request against the limit (50 names cost 5).
const MAX_BATCH = 50;
const NAMES_PER_REQUEST = 10;

// The API allows 60 requests a minute per IP, shared by all our users, in a fixed minute that starts at its first
// request. 55 leaves room for a request that straddles two windows (up to 5) and a second for network jitter; see
// WindowBudget.
const BUDGET = 55;
const WINDOW_MS = 61_000;

// Mana Vault's price API (POST /api/v1/prices): every in-stock offer of every printing, no key. `source` tells
// them who's calling: our site's domain, which Railway sets on deploys; a fixed name elsewhere (local runs).
// Searches are batched (see Batcher) and go out as soon as the minute's budget allows, so a search that fits in it
// isn't held back by the limit at all.
// See https://manavaultstore.com/api/docs.
export const manavaultSource = () =>
    process.env.RAILWAY_PUBLIC_DOMAIN || 'mtg-ua-card-searcher';

export class ManavaultCardSearcher implements CardSearcher {
    readonly shop = 'manavault';
    readonly batched = true;
    private readonly batcher = new Batcher<string, ManavaultAnswer>(
        (cards, signal) => this.send(cards, signal),
        MAX_BATCH
    );

    constructor(
        private readonly client = new ShopClient('https://manavaultstore.com'),
        private readonly source = manavaultSource(),
        private readonly budget = new WindowBudget(BUDGET, WINDOW_MS)
    ) {}

    async search(
        card: string,
        signal?: AbortSignal,
        _fullName?: string,
        urgent = false
    ): Promise<CardResult[]> {
        const answer = await this.batcher.add(card, signal, urgent);
        // the batch answers a name it rejects (shorter than 2 letters) with `error` instead of failing the request
        if (answer.error) throw new ShopRequestError(answer.error);
        return parseManavault(answer);
    }

    private async send(cards: string[], signal: AbortSignal) {
        const cost = Math.ceil(cards.length / NAMES_PER_REQUEST);
        const json = await this.budget.run(
            cost,
            async () => {
                try {
                    return await this.client.fetchJson<{
                        answers?: ManavaultAnswer[];
                    }>(this.client.url('/api/v1/prices'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cards, source: this.source }),
                        signal
                    });
                } catch (err) {
                    if (err instanceof HttpError && err.status === 429)
                        this.budget.exhaust();
                    throw err;
                }
            },
            signal
        );
        // answers come back in request order
        return cards.map((_, i) => json?.answers?.[i] ?? {});
    }
}
