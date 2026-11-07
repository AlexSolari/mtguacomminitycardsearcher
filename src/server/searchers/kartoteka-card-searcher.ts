import { parseKartoteka } from '../parsers/kartoteka';
import type { CardResult } from '../../search-result';
import { warnIfEmpty, type CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

export class KartotekaCardSearcher implements CardSearcher {
    readonly shop = 'kartoteka';

    constructor(
        private readonly client = new ShopClient('https://kartoteka.in.ua')
    ) {}

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        const url = this.client.url('/ua/search/', {
            q: card
        });
        return warnIfEmpty(
            this.shop,
            url,
            parseKartoteka(
                await this.client.fetchHtml(url, { signal }),
                this.client.baseUrl
            )
        );
    }
}
