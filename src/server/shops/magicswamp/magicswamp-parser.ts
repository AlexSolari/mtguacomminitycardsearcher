import type { CardResult } from '@/shared/search-result';
import {
    abs,
    capitalize,
    isArtSeriesSet,
    languageCode,
    toPrice,
    withEdition
} from '@/server/shops/parse-helpers';

// magicswamp.com.ua/api/listings/grouped/cards?game=mtg&search=… — a marketplace of private sellers. One entry per
// printing, with every seller's offer for it:
//   {"data":[{"card_id":"8d1ec351-…","card_name":"Boltwave","set_code":"fdn","set_name":"Foundations",
//     "card_image_url":"https://img.magicswamp.com.ua/cards/fdn/8d1ec351-….jpg","game":"mtg","lowest_price":104,
//     "sellers":[{"listing_id":"51012868-…","price":104,"currency":"UAH","condition":"near_mint","is_foil":false,
//       "foil_type":"none","quantity":1,"language":"en", …seller details}]}, …],"total":2,"page":1,"totalPages":1}
// Only the fields read here are typed; the API has more, including the sellers' names, which we don't use.
export type MagicswampOffer = {
    listing_id: string;
    price: number | string | null;
    currency: string | null;
    condition: string | null;
    is_foil: boolean;
    foil_type: string | null; // "none", "foil", "etched", "halo", "surge"…
    quantity: number;
    language: string | null;
};

export type MagicswampCard = {
    card_name: string;
    set_name: string | null;
    card_image_url: string | null;
    game: string;
    sellers?: MagicswampOffer[];
};

export type MagicswampResponse = {
    data?: MagicswampCard[];
    total?: number;
    totalPages?: number;
};

// The badges the site itself shows for each condition, so ours match what the user finds on the listing.
const CONDITIONS: Record<string, string> = {
    mint: 'NM',
    near_mint: 'NM',
    excellent: 'NM',
    good: 'LP',
    light_played: 'LP',
    played: 'MP',
    poor: 'DMG'
};

// One result per seller's offer, linked to that listing (/mtg/listing/<id>), like MTGin's per-offer results.
export function parseMagicswamp(
    json: MagicswampResponse,
    base: string
): CardResult[] {
    return (json?.data ?? [])
        .filter((c) => c?.card_name && c.game === 'mtg')
        .flatMap((c) =>
            (c.sellers ?? [])
                .filter((o) => o?.listing_id && o.quantity > 0)
                .map((o) => {
                    // Plain foil is the `foil` badge; special finishes (etched, halo, surge…) are named.
                    const finish =
                        o.foil_type && !['none', 'foil'].includes(o.foil_type)
                            ? capitalize(o.foil_type)
                            : null;
                    return {
                        shop: 'magicswamp' as const,
                        // "Boltwave — Foundations, Etched"
                        name: withEdition(
                            c.card_name,
                            c.set_name,
                            null,
                            finish
                        ),
                        url: abs(base, `/mtg/listing/${o.listing_id}`)!,
                        image: abs(base, c.card_image_url ?? undefined),
                        // unknown when not in hryvnias
                        price:
                            (o.currency ?? 'UAH') === 'UAH'
                                ? toPrice(o.price)
                                : null,
                        artSeries: isArtSeriesSet(c.set_name),
                        stock: o.quantity,
                        foil: o.is_foil,
                        language: languageCode(o.language),
                        condition: CONDITIONS[o.condition ?? '']
                    };
                })
        );
}
