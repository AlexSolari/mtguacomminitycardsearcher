import {
    parseMagicswamp,
    type MagicswampResponse
} from '@/server/shops/magicswamp/magicswamp-parser';
import type { CardResult } from '@/shared/search-result';
import type { CardSearcher } from '@/server/search/card-searcher';
import { logger } from '@/server/observability/logger';
import { ShopClient } from '@/server/outbound/shop-client';

// The site is a React app; its own JSON API is what the search page calls. `search` matches part of the name.
export class MagicswampCardSearcher implements CardSearcher {
    readonly shop = 'magicswamp';

    constructor(
        // The API allows 300 requests a minute (`ratelimit-policy: 300;w=60`), shared by every user. The default
        // 200 ms gap would be exactly 300, so leave some room for requests that arrive bunched up.
        private readonly client = new ShopClient('https://magicswamp.com.ua', {
            intervalMs: 220
        })
    ) {}

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        // One entry per printing; 100 is the API's maximum page size. The stock is small enough that even a short
        // name ("Opt") matches only a handful of printings, so we don't fetch further pages.
        const url = this.client.url('/api/listings/grouped/cards', {
            game: 'mtg',
            search: card,
            limit: '100'
        });
        const json = await this.client.fetchJson<MagicswampResponse>(url, {
            signal
        });
        // If that stops holding, offers past the first page are missing from our results: time to fetch the rest.
        if ((json?.totalPages ?? 1) > 1)
            logger.error('magicswamp results span several pages', {
                shop: this.shop,
                card,
                total: json.total,
                totalPages: json.totalPages
            });
        return parseMagicswamp(json, this.client.baseUrl);
    }
}
