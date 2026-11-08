import { parseCarton, parseCartonProduct } from '../parsers/scrapers/carton';
import { isExactMatch } from '../../matching';
import type { CardResult } from '../../search-result';
import {
    expandCheapest,
    warnIfEmpty,
    type CardSearcher
} from '../card-searcher';
import { ShopClient } from '../shop-client';

// CartOn's search lists one product per printing in stock, with only its cheapest price. For exact matches, the
// product page is fetched too: its offers give each copy's stock, finish, language and condition. Fuzzy "other
// matches" keep their search tile (see expandCheapest for the cap and fallbacks).
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
        return expandCheapest(
            this.shop,
            found,
            (tile) => isExactMatch(tile.name, card),
            async (tile) =>
                parseCartonProduct(
                    await this.client.fetchHtml(tile.url, { signal }),
                    tile.url
                ),
            signal
        );
    }
}
