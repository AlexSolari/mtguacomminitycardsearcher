import { parseManavault, type ManavaultAnswer } from '../parsers/api/manavault';
import type { CardResult } from '../../search-result';
import { Batcher } from '../batcher';
import type { CardSearcher } from '../card-searcher';
import { ShopClient, ShopRequestError } from '../shop-client';

// The API takes up to 50 names per request, but every 10 names count as one request against the limit (50 names
// cost 5), so a batch over 10 spends the budget faster without finding cards any faster: at our pace (below),
// batches of 10 already make about 545 cards a minute, near the API's 600.
const MAX_BATCH = 10;

// Mana Vault's price API (POST /api/v1/prices): every in-stock offer of every printing, no key. `source` tells
// them who's calling: our site's domain, which Railway sets on deploys; a fixed name elsewhere (local runs).
// The API allows 60 requests a minute for all our users together, so searches are batched (see Batcher).
// See https://manavaultstore.com/api/docs.
export const manavaultSource = () =>
    process.env.RAILWAY_PUBLIC_DOMAIN || 'mtg-ua-card-searcher';

export class ManavaultCardSearcher implements CardSearcher {
    readonly shop = 'manavault';
    private readonly batcher = new Batcher<string, ManavaultAnswer>(
        (cards, signal) => this.send(cards, signal),
        MAX_BATCH
    );

    constructor(
        // The minute is a fixed window starting at its first request, not a rolling one. At exactly a second
        // apart, the 61st request can arrive inside the window when the first one was delayed more than it was;
        // 1.1 s leaves the window 6 s of slack.
        private readonly client = new ShopClient('https://manavaultstore.com', {
            intervalMs: 1100
        }),
        private readonly source = manavaultSource()
    ) {}

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        const answer = await this.batcher.add(card, signal);
        // the batch answers a name it rejects (shorter than 2 letters) with `error` instead of failing the request
        if (answer.error) throw new ShopRequestError(answer.error);
        return parseManavault(answer);
    }

    private async send(cards: string[], signal: AbortSignal) {
        const json = await this.client.fetchJson<{
            answers?: ManavaultAnswer[];
        }>(this.client.url('/api/v1/prices'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cards, source: this.source }),
            signal
        });
        // answers come back in request order
        return cards.map((_, i) => json?.answers?.[i] ?? {});
    }
}
