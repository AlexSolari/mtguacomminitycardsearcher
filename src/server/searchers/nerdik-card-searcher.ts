import { parseNerdik } from '../parsers/nerdik';
import type { CardResult } from '../../shops';
import { withQuery, type CardSearcher } from '../card-searcher';
import type { ShopClient } from '../shop-client';

export class NerdikCardSearcher implements CardSearcher {
    readonly shop = 'nerdik';

    constructor(private readonly client: ShopClient) {}

    async search(card: string): Promise<CardResult[]> {
        return parseNerdik(
            await this.client.fetchHtml(
                withQuery('https://nerdik.club/katalog/search/', { q: card })
            )
        );
    }
}
