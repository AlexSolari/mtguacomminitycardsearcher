import { parseNerdik, type NerdikResponse } from '../parsers/api/nerdik';
import type { CardResult } from '../../search-result';
import { warnIfEmpty, type CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

// Nerdik's hub API needs a key (X-API-Key), read from NERDIK_API_KEY (Bun loads .env).
export class NerdikCardSearcher implements CardSearcher {
    readonly shop = 'nerdik';

    constructor(
        private readonly client = new ShopClient('https://hub.nerdik.club'),
        private readonly apiKey = process.env.NERDIK_API_KEY
    ) {}

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        if (!this.apiKey) throw new Error('NERDIK_API_KEY is not set');
        // 60 is the API's maximum page size; one page covers every printing of all but the basic lands
        const url = this.client.url('/api/singles/search', {
            q: card,
            limit: '60'
        });
        return warnIfEmpty(
            this.shop,
            url,
            parseNerdik(
                await this.client.fetchJson<NerdikResponse>(url, {
                    headers: { 'X-API-Key': this.apiKey },
                    signal
                })
            )
        );
    }
}
