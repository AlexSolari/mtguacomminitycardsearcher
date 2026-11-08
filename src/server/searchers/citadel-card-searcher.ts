import { parseCitadel } from '../parsers/citadel';
import type { CardResult } from '../../search-result';
import { warnIfEmpty, type CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

// The singles search page, rendered on the server. `q` matches part of the name; a page holds 24 items, which
// covers every printing in stock of all but the basic lands, so only the first page is fetched.
export class CitadelCardSearcher implements CardSearcher {
    readonly shop = 'citadel';

    constructor(
        private readonly client = new ShopClient('https://citadel.kyiv.ua')
    ) {}

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        const url = this.client.url('/singles', { q: card });
        return warnIfEmpty(
            this.shop,
            url,
            parseCitadel(
                await this.client.fetchHtml(url, { signal }),
                this.client.baseUrl
            )
        );
    }
}
