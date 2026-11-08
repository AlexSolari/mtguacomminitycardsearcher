import { parseCarton } from '../parsers/scrapers/carton';
import type { CardResult } from '../../search-result';
import { warnIfEmpty, type CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

export class CartonCardSearcher implements CardSearcher {
    readonly shop = 'carton';

    constructor(
        private readonly client = new ShopClient('https://carton.cards')
    ) {}

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        const url = this.client.url('/search', { q: card });
        return warnIfEmpty(
            this.shop,
            url,
            parseCarton(
                await this.client.fetchHtml(url, { signal }),
                this.client.baseUrl
            )
        );
    }
}
