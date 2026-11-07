import { parseGin, parseGinPrintings } from '../parsers/gin';
import { isExactMatch } from '../../matching';
import type { CardResult } from '../../search-result';
import { warnFallback, warnIfEmpty, type CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

// MTGin's search shows one summary tile per card when it has several printings ("4 версії · від 42 ₴"), linking to
// /cards/oracle/<id>. For exact matches, expand that page into one result per printing (and seller), like Mana Vault.
// If the expansion fails or comes back empty, the summary tile stays.
export class GinCardSearcher implements CardSearcher {
    readonly shop = 'gin';

    constructor(
        private readonly client = new ShopClient('https://mtgin.kyiv.ua')
    ) {}

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        const base = this.client.baseUrl;
        const url = this.client.url('/', { q: card });
        const found = warnIfEmpty(
            this.shop,
            url,
            parseGin(await this.client.fetchHtml(url, { signal }), base)
        );
        const expanded = await Promise.all(
            found.map(async (l) => {
                if (!l.printings || !isExactMatch(l.name, card)) return [l];
                try {
                    const printings = warnIfEmpty(
                        this.shop,
                        l.url,
                        parseGinPrintings(
                            await this.client.fetchHtml(l.url, { signal }),
                            base
                        )
                    );
                    return printings.length > 0 ? printings : [l];
                } catch (err) {
                    warnFallback(this.shop, l.url, err, signal);
                    return [l];
                }
            })
        );
        return expanded.flat();
    }
}
