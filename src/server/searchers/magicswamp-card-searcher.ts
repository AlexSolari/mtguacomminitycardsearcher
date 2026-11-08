import {
    parseMagicswamp,
    type MagicswampResponse
} from '../parsers/api/magicswamp';
import type { CardResult } from '../../search-result';
import { warnIfEmpty, type CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

// The site is a React app; its own JSON API is what the search page calls. `search` matches part of the name.
export class MagicswampCardSearcher implements CardSearcher {
    readonly shop = 'magicswamp';

    constructor(
        private readonly client = new ShopClient('https://magicswamp.com.ua')
    ) {}

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        // one entry per printing; 50 covers every printing in stock of all but the basic lands
        const url = this.client.url('/api/listings/grouped/cards', {
            game: 'mtg',
            search: card,
            limit: '50'
        });
        return warnIfEmpty(
            this.shop,
            url,
            parseMagicswamp(
                await this.client.fetchJson<MagicswampResponse>(url, {
                    signal
                }),
                this.client.baseUrl
            )
        );
    }
}
