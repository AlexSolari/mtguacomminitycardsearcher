import type { CardResult } from '@/shared/search-result';
import { SHOP_INFO } from '@/shared/shops';
import { asString, languageCode, toPrice } from '@/server/shops/parse-helpers';

const CONDITIONS: Record<string, string> = {
    mint: 'M',
    near_mint: 'NM',
    excellent: 'EX',
    lightly_played: 'LP',
    good: 'GD',
    moderately_played: 'MP',
    played: 'PL',
    heavily_played: 'HP',
    poor: 'PO',
    damaged: 'DMG'
};

// One lot, as the API sends it; every field is checked, since a lot that isn't what we expect is skipped rather
// than failing the shop:
//   { "id": "96c2…", "title": "2x - Undercity Sewers #270", "status": "live", "condition": "near_mint",
//     "foil": false, "language": "EN", "starting_price_uah": 1000, "buy_now_uah": null, "current_high_uah": 1020,
//     "bid_count": 2, "end_time": "2026-11-08T20:00:00.000Z",
//     "photos": [{ "urls": { "medium": "https://…/medium.webp", "thumb": "https://…/thumb.webp" } }] }
type Lot = Partial<
    Record<
        | 'id'
        | 'title'
        | 'status'
        | 'condition'
        | 'foil'
        | 'language'
        | 'starting_price_uah'
        | 'buy_now_uah'
        | 'current_high_uah'
        | 'bid_count'
        | 'end_time'
        | 'photos',
        unknown
    >
>;

const grade = (condition: unknown) => {
    const c = asString(condition);
    return c !== undefined && Object.hasOwn(CONDITIONS, c)
        ? CONDITIONS[c]
        : undefined;
};

function photo(photos: unknown): string | null {
    const urls = Array.isArray(photos) ? photos[0]?.urls : undefined;
    return asString(urls?.medium) ?? asString(urls?.thumb) ?? null;
}

// paytowin.club — card auctions, via the site's public JSON API (api.paytowin.club/auctions?q=…&game=magic), as
// { "items": [Lot, …] }. Titles are free text written by sellers ("Raucous Theater #266", "4х Viper"); photos are
// the seller's own.
export function parsePaytowin(json: unknown): CardResult[] {
    const items: unknown = (json as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) return [];
    return items.flatMap((item): CardResult[] => {
        const a = (item ?? {}) as Lot;
        const id =
            asString(a.id) ?? (typeof a.id === 'number' ? a.id : undefined);
        const startingPrice = toPrice(a.starting_price_uah);
        // every lot has a starting price; one without isn't a lot we can show
        if (a.status !== 'live' || id === undefined || startingPrice === null)
            return [];
        const currentBid = toPrice(a.current_high_uah);
        const bids = Number(a.bid_count);
        return [
            {
                shop: 'paytowin',
                name: (asString(a.title) ?? '').trim(),
                // the API host isn't the site: lots live at paytowin.club/a/<id>
                url: `${SHOP_INFO.paytowin.homepage}/a/${encodeURIComponent(id)}`,
                image: photo(a.photos),
                price: currentBid ?? startingPrice,
                foil: a.foil === true || undefined,
                language: languageCode(asString(a.language)),
                condition: grade(a.condition),
                auction: {
                    currentBid,
                    startingPrice,
                    buyNow: toPrice(a.buy_now_uah),
                    endsAt: asString(a.end_time) ?? '',
                    bids: Number.isInteger(bids) && bids > 0 ? bids : 0
                }
            }
        ];
    });
}
