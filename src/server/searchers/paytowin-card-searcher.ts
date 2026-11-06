import { parsePaytowin } from '../parsers/paytowin';
import type { CardResult } from '../../shops';
import { withQuery, type CardSearcher } from '../card-searcher';
import type { ShopClient } from '../shop-client';

export class PaytowinCardSearcher implements CardSearcher {
    readonly shop = 'paytowin';

    constructor(private readonly client: ShopClient) {}

    async search(card: string): Promise<CardResult[]> {
        const url = withQuery('https://api.paytowin.club/auctions', {
            q: card,
            game: 'magic',
            limit: '50'
        });
        return parsePaytowin(await this.client.fetchJson(url));
    }
}
