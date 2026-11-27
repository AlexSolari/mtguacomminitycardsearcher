import {
    parseMagicswamp,
    type MagicswampCard,
    type MagicswampResponse
} from '@/server/shops/magicswamp/magicswamp-parser';
import type { CardResult } from '@/shared/search-result';
import { normalize } from '@/shared/matching';
import { Batcher } from '@/server/outbound/batcher';
import type { CardSearcher } from '@/server/search/card-searcher';
import { logger } from '@/server/observability/logger';
import { ShopClient } from '@/server/outbound/shop-client';

// `names[]` takes up to 100 names. Past that the API doesn't refuse the request: it answers as if none were in stock.
export const MAX_BATCH = 100;
// The API's largest page, in printings.
const PAGE_SIZE = 100;
// A batch of 100 names usually fits in a page or two, though a basic land alone has a few dozen printings in stock.
// Pages past this are left unread (and logged) rather than spending the request budget every user shares.
export const MAX_PAGES = 5;

// The site is a React app; its own JSON API is what its deck search calls:
//   /api/listings/grouped/cards?game=mtg&names[]=Forest&names[]=Turn // Burn&limit=100&page=1
// `names[]` matches whole names, ignoring case, and a split or double-faced card only by its full name ("Turn" finds
// nothing). So cards are searched by their full name, like Nerdik's, and searches are batched (see Batcher).
export class MagicswampCardSearcher implements CardSearcher {
    readonly shop = 'magicswamp';
    readonly batched = true;
    private readonly batcher = new Batcher<string, MagicswampCard[]>(
        (names, signal) => this.send(names, signal),
        MAX_BATCH
    );

    constructor(
        // The API allows 300 requests a minute (`ratelimit-policy: 300;w=60`), shared by every user. The default
        // 200 ms gap would be exactly 300, so leave some room for requests that arrive bunched up.
        private readonly client = new ShopClient('https://magicswamp.com.ua', {
            intervalMs: 220
        })
    ) {}

    // Parsed here rather than for the whole batch, so a printing the parser chokes on fails only its own card.
    async search(
        card: string,
        signal?: AbortSignal,
        fullName = card,
        urgent = false
    ): Promise<CardResult[]> {
        const data = await this.batcher.add(fullName, signal, urgent);
        return parseMagicswamp({ data }, this.client.baseUrl);
    }

    // The answer is one list of printings for every name, in pages, each printing under its card's name; they're
    // sorted back to the names here.
    private async send(names: string[], signal: AbortSignal) {
        const byName = new Map(
            names.map((name) => [normalize(name), [] as MagicswampCard[]])
        );
        const seen = new Set<string>();
        let unclaimed = 0;
        for (let page = 1, pages = 1; page <= pages; page++) {
            const json = await this.client.fetchJson<MagicswampResponse>(
                this.pageUrl(names, page),
                { signal }
            );
            const total = json?.totalPages ?? 1;
            if (page === 1 && total > MAX_PAGES)
                logger.error('magicswamp results span too many pages', {
                    shop: this.shop,
                    names: names.length,
                    total: json.total,
                    totalPages: total
                });
            pages = Math.min(total, MAX_PAGES);
            for (const card of json?.data ?? []) {
                // a printing that moves to the next page while they're read would come twice
                if (card?.card_id) {
                    if (seen.has(card.card_id)) continue;
                    seen.add(card.card_id);
                }
                const name = card?.card_name;
                const list =
                    typeof name === 'string' && byName.get(normalize(name));
                if (list) list.push(card);
                else unclaimed++;
            }
        }
        // A printing under a name we didn't send means the API matches names differently from `normalize`: the card
        // it belongs to shows nothing.
        if (unclaimed > 0)
            logger.warn("batch answers don't match the request", {
                shop: this.shop,
                sent: names.length,
                unclaimed
            });
        return names.map((name) => byName.get(normalize(name))!);
    }

    private pageUrl(names: string[], page: number) {
        return this.client.url('/api/listings/grouped/cards', [
            ['game', 'mtg'],
            // the same card searched by two users at once goes in once
            ...[...new Set(names)].map((name): [string, string] => [
                'names[]',
                name
            ]),
            ['limit', String(PAGE_SIZE)],
            ['page', String(page)],
            // a fixed order (the one the site's own requests use), so the pages don't shift between requests
            ['sortBy', 'price_asc']
        ]);
    }
}
