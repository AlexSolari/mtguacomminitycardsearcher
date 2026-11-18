import {
    parseCarton,
    parseCartonNextPage,
    parseCartonProduct
} from '../parsers/scrapers/carton';
import { isExactMatch } from '../../matching';
import type { CardResult } from '../../search-result';
import {
    expandCheapest,
    warnFallback,
    warnIfEmpty,
    type CardSearcher
} from '../card-searcher';
import { ShopClient } from '../shop-client';

// CartOn's search matches anywhere in the name ("Opt" finds Thopters and Optics), newest first, 24 a page, so an
// older printing of a short name can sit past the first page. Up to this many pages are read.
export const MAX_SEARCH_PAGES = 3;

// CartOn's search lists one product per printing in stock, with only its cheapest price. For exact matches, the
// product page is fetched too: its offers give each copy's stock, finish, language and condition. Fuzzy "other
// matches" keep their search tile (see expandCheapest for the cap and fallbacks).
export class CartonCardSearcher implements CardSearcher {
    readonly shop = 'carton';

    constructor(
        private readonly client = new ShopClient('https://carton.cards')
    ) {}

    // The search is limited to Magic: other games' products would only push Magic's to later pages.
    private searchUrl(card: string, page: number) {
        return this.client.url('/search', {
            q: card,
            universe: 'magic-the-gathering',
            ...(page > 1 ? { page: String(page) } : {})
        });
    }

    async search(card: string, signal?: AbortSignal): Promise<CardResult[]> {
        const firstUrl = this.searchUrl(card, 1);
        let html = await this.client.fetchHtml(firstUrl, { signal });
        const found = warnIfEmpty(
            this.shop,
            firstUrl,
            parseCarton(html, this.client.baseUrl)
        );
        for (let pages = 1; pages < MAX_SEARCH_PAGES; pages++) {
            const next = parseCartonNextPage(html);
            if (!next) break;
            const url = this.searchUrl(card, next);
            try {
                html = await this.client.fetchHtml(url, { signal });
            } catch (err) {
                warnFallback(this.shop, url, err, signal);
                break;
            }
            found.push(...parseCarton(html, this.client.baseUrl));
        }
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
