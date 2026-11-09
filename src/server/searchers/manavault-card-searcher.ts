import {
    parseManavault,
    type ManavaultResponse
} from '../parsers/api/manavault';
import type { CardResult } from '../../search-result';
import type { CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

// Mana Vault's price API: one request per card, every in-stock offer of every printing, no key. `source` tells
// them who's calling: our site's domain, which Railway sets on deploys; a fixed name elsewhere (local runs).
// The API allows 60 requests a minute for all our users together, hence one a second.
export const manavaultSource = () =>
    process.env.RAILWAY_PUBLIC_DOMAIN || 'mtg-ua-card-searcher';

export class ManavaultCardSearcher implements CardSearcher {
    readonly shop = 'manavault';

    constructor(
        private readonly client = new ShopClient('https://manavaultstore.com', {
            intervalMs: 1000
        }),
        private readonly source = manavaultSource()
    ) {}

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        const url = this.client.url('/api/v1/prices', {
            q: card,
            source: this.source
        });
        return parseManavault(
            await this.client.fetchJson<ManavaultResponse>(url, { signal })
        );
    }
}
