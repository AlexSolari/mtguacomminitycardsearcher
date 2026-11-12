import { parseNerdik, type NerdikBatchResponse } from '../parsers/api/nerdik';
import type { CardResult } from '../../search-result';
import { Batcher } from '../batcher';
import type { CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

// The API takes up to 100 names per request.
const MAX_BATCH = 100;

// Nerdik's hub API needs a key (X-API-Key), read from NERDIK_API_KEY (Bun loads .env).
// Its batch search looks up many names per request, so searches are batched like MTGin's (see Batcher).
// It matches whole names exactly (case-insensitive): "Bonecrusher Giant" finds nothing, only
// "Bonecrusher Giant // Stomp" does. So it's searched by the full name, and never returns fuzzy "other matches".
export class NerdikCardSearcher implements CardSearcher {
    readonly shop = 'nerdik';
    readonly batched = true;
    private readonly batcher = new Batcher<string, CardResult[]>(
        (names, signal) => this.send(names, signal),
        MAX_BATCH
    );

    constructor(
        private readonly client = new ShopClient('https://hub.nerdik.club'),
        private readonly apiKey = process.env.NERDIK_API_KEY
    ) {}

    search(
        card: string,
        signal?: AbortSignal,
        fullName = card,
        urgent = false
    ): Promise<CardResult[]> {
        if (!this.apiKey)
            return Promise.reject(new Error('NERDIK_API_KEY is not set'));
        return this.batcher.add(fullName, signal, urgent);
    }

    private async send(names: string[], signal: AbortSignal) {
        const json = await this.client.fetchJson<NerdikBatchResponse>(
            this.client.url('/api/singles/search/batch'),
            {
                method: 'POST',
                headers: {
                    'X-API-Key': this.apiKey!,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    game: 'mtg',
                    // 60 is the API's maximum per name; it covers every printing of all but the basic lands
                    limit: 60,
                    // quantity is required; the list's own quantity doesn't change what's returned
                    cards: names.map((name) => ({ name, quantity: 1 }))
                }),
                signal
            }
        );
        // results come back in request order
        return names.map((_, i) => parseNerdik(json?.results?.[i]));
    }
}
