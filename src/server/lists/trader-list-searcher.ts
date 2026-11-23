import type { CardResult } from '@/shared/search-result';
import type { CardSearcher } from '@/server/search/card-searcher';
import type { ListOffer, ListStore } from '@/server/lists/list-store';
import { LIST_SOURCES } from '@/server/lists/list-link';

// What traders' approved lists have of a card (see lists/list-refresher.ts, which keeps them up to date).
// Unlike the shops' searchers, it fetches nothing: it reads the database, so it has no ShopClient and isn't cached
// (CachedCardSearcher). A list shows in search as soon as its first read is stored.
export class TraderListSearcher implements CardSearcher {
    readonly shop = 'traders';

    constructor(private readonly lists: Pick<ListStore, 'offers'>) {}

    async search(card: string, _signal?: AbortSignal, fullName = card) {
        return this.lists.offers(card, fullName).map(traderOffer);
    }
}

// A row of a trader's list as a search result: it opens the trader's Telegram, and its price is Scryfall's in USD.
export function traderOffer(o: ListOffer): CardResult {
    const printing = [
        o.set?.toUpperCase(),
        o.collectorNumber && `#${o.collectorNumber}`,
        o.variant,
        o.finish === 'etched' && 'etched'
    ]
        .filter(Boolean)
        .join(' · ');
    return {
        shop: 'traders',
        name: o.name,
        url: `https://t.me/${o.username}`,
        image: o.image,
        price: null,
        stock: o.quantity,
        ...(o.finish !== 'nonfoil' && { foil: true }),
        ...(o.usd !== null && {
            usdPrice: o.usd,
            ...(o.approxPrice && { approxPrice: true }),
            ...(o.usdRate !== null && { usdRate: o.usdRate })
        }),
        seller: {
            name: o.displayName,
            username: o.username,
            list: LIST_SOURCES[o.source].link(o.ref),
            listTitle: o.title,
            updatedAt: o.fetchedAt,
            printing: printing || null
        }
    };
}
