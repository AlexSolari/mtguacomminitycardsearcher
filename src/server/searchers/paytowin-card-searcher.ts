import { parsePaytowin } from '@/server/parsers/api/paytowin';
import type { CardResult } from '@/shared/search-result';
import type { CardSearcher } from '@/server/search/card-searcher';
import { ShopClient } from '@/server/outbound/shop-client';

export class PaytowinCardSearcher implements CardSearcher {
    readonly shop = 'paytowin';

    constructor(
        private readonly client = new ShopClient('https://api.paytowin.club')
    ) {}

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        const url = this.client.url('/auctions', {
            q: card,
            game: 'magic',
            limit: '50'
        });
        return parsePaytowin(await this.client.fetchJson(url, { signal }));
    }
}
