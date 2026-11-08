import { parsePaytowin } from '../parsers/api/paytowin';
import type { CardResult } from '../../search-result';
import { warnIfEmpty, type CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

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
        return warnIfEmpty(
            this.shop,
            url,
            parsePaytowin(await this.client.fetchJson(url, { signal }))
        );
    }
}
