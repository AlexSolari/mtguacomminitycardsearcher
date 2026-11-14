import {
    parseGin,
    type GinLookupResult,
    type GinResponse
} from '../parsers/api/gin';
import type { CardResult } from '../../search-result';
import { Batcher, pairAnswers } from '../batcher';
import type { CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

// The API takes up to 100 lookups per request.
const MAX_BATCH = 100;

// MTGin's partner API (POST /api/public/v1/search) needs a key, read from MTGIN_API_KEY (Bun loads .env).
// The key allows 60 requests a minute, shared by every user of this server, so searches are batched (see Batcher).
// The API matches names exactly (case-insensitive, either face of a double-faced card), so it never returns the fuzzy
// "other matches" a search page would.
export class GinCardSearcher implements CardSearcher {
    readonly shop = 'gin';
    readonly batched = true;
    private readonly batcher = new Batcher<string, GinLookupResult>(
        (cards, signal) => this.send(cards, signal),
        MAX_BATCH
    );

    constructor(
        // one request a second stays within the key's 60 a minute
        private readonly client = new ShopClient('https://mtgin.kyiv.ua', {
            intervalMs: 1000
        }),
        private readonly apiKey = process.env.MTGIN_API_KEY
    ) {}

    // Parsed here rather than for the whole batch, so an answer the parser chokes on fails only its own card.
    async search(
        card: string,
        signal?: AbortSignal,
        _fullName?: string,
        urgent = false
    ): Promise<CardResult[]> {
        if (!this.apiKey) throw new Error('MTGIN_API_KEY is not set');
        return parseGin(
            await this.batcher.add(card, signal, urgent),
            this.client.baseUrl
        );
    }

    private async send(cards: string[], signal: AbortSignal) {
        const json = await this.client.fetchJson<GinResponse>(
            this.client.url('/api/public/v1/search'),
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cards: cards.map((name) => ({ name }))
                }),
                signal
            }
        );
        return pairAnswers(
            this.shop,
            cards,
            json?.results,
            (r) => r.query?.name
        );
    }
}
