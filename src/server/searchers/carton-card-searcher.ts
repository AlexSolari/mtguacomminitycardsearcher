import { parseCarton, parseCartonProduct } from '../parsers/scrapers/carton';
import { isExactMatch } from '../../matching';
import type { CardResult } from '../../search-result';
import { warnFallback, warnIfEmpty, type CardSearcher } from '../card-searcher';
import { ShopClient } from '../shop-client';

// Product pages fetched per search at most. Each costs a request; Sol Ring alone has 15 printings in stock, and
// a few such cards in flight would push the shop's queue past its wait limit.
const MAX_PRODUCT_PAGES = 10;

// CartOn's search lists one product per printing in stock, with only its cheapest price. For exact matches, the
// product page is fetched too: its offers give each copy's stock, finish, language and condition. Only the
// cheapest MAX_PRODUCT_PAGES printings are expanded; the rest, and fuzzy "other matches", keep their search tile,
// as does a product whose page fails or lists no offers.
export class CartonCardSearcher implements CardSearcher {
    readonly shop = 'carton';

    constructor(
        private readonly client = new ShopClient('https://carton.cards')
    ) {}

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        const searchUrl = this.client.url('/search', { q: card });
        const found = warnIfEmpty(
            this.shop,
            searchUrl,
            parseCarton(
                await this.client.fetchHtml(searchUrl, { signal }),
                this.client.baseUrl
            )
        );

        const expand = new Set(
            found
                .filter((t) => isExactMatch(t.name, card))
                .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
                .slice(0, MAX_PRODUCT_PAGES)
        );
        const results = await Promise.all(
            found.map(async (tile) => {
                if (!expand.has(tile)) return [tile];
                try {
                    const offers = warnIfEmpty(
                        this.shop,
                        tile.url,
                        parseCartonProduct(
                            await this.client.fetchHtml(tile.url, { signal }),
                            tile.url
                        )
                    );
                    return offers.length > 0 ? offers : [tile];
                } catch (err) {
                    warnFallback(this.shop, tile.url, err, signal);
                    return [tile];
                }
            })
        );
        return results.flat();
    }
}
