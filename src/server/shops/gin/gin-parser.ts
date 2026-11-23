import type { CardResult } from '@/shared/search-result';
import {
    abs,
    isArtSeriesSet,
    languageCode,
    toPrice,
    withEdition
} from '@/server/shops/parse-helpers';

// mtgin.kyiv.ua/api/public/v1/search — the partner API. The answer to a batch of lookups has one entry per lookup, in
// request order, each with the matching offers (one per printing, finish, condition and seller), cheapest first:
//   {"currency":"UAH","results":[{"query":{"name":"Sol Ring",…},"totalQuantity":4,"offers":[
//     {"name":"Sol Ring","set":"cmm","setName":"Commander Masters","collectorNumber":"1","language":"en",
//      "finish":"nonfoil","condition":"normal","signed":false,"quantity":3,"priceUah":200,
//      "url":"https://mtgin.kyiv.ua/shops/mtgin/cards/1042-sol-ring","imageUrl":"https://mtgin.kyiv.ua/api/card-images/….jpg",
//      "shop":{"slug":"mtgin","name":"MTGin"}}, …]}, …]}
// Only the fields read here are typed; the API may add others.
export type GinOffer = {
    name: string;
    setName: string | null;
    collectorNumber: string | null;
    language: string | null;
    finish: string | null; // "nonfoil", "foil" or "etched"
    condition: string | null; // "normal" or "heavily_played"
    signed: boolean;
    quantity: number;
    priceUah: number | null;
    url: string;
    imageUrl: string | null;
};

// `query` echoes the lookup as sent (the searcher pairs answers with names by it, see pairAnswers)
export type GinLookupResult = {
    query?: { name?: string };
    offers?: GinOffer[];
};
export type GinResponse = { results?: GinLookupResult[] };

export function parseGin(
    result: GinLookupResult | undefined,
    base: string
): CardResult[] {
    return (result?.offers ?? []).flatMap((o): CardResult[] => {
        // an offer without a link (or with one that isn't a URL) is skipped, not the whole lookup
        const url = o?.name && o.quantity > 0 ? abs(base, o.url) : null;
        if (!url) return [];
        return [
            {
                shop: 'gin',
                // "Sol Ring — Commander Masters #1, Etched"
                name: withEdition(
                    o.name,
                    o.setName,
                    o.collectorNumber,
                    o.finish === 'etched' && 'Etched',
                    o.signed && 'Signed'
                ),
                url,
                image: abs(base, o.imageUrl ?? undefined),
                price: toPrice(o.priceUah),
                artSeries: isArtSeriesSet(o.setName),
                stock: o.quantity,
                foil: o.finish ? o.finish !== 'nonfoil' : undefined,
                language: languageCode(o.language),
                // "normal" covers everything short of heavily played, so it gets no badge
                condition: o.condition === 'heavily_played' ? 'HP' : undefined
            }
        ];
    });
}
