import { parseNerdik } from '../parsers/nerdik';
import type { CardResult } from '../../shops';
import { warnIfEmpty, type CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

export class NerdikCardSearcher implements CardSearcher {
    readonly shop = 'nerdik';

    constructor(
        private readonly client = new ShopClient('https://nerdik.club')
    ) {}

    async search(card: string): Promise<CardResult[]> {
        const url = this.client.url('/katalog/search/', {
            q: card
        });
        return warnIfEmpty(
            this.shop,
            url,
            parseNerdik(await this.client.fetchHtml(url))
        );
    }
}
