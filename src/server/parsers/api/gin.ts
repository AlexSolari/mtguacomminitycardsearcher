import type { CardResult } from '../../../search-result';
import { abs, languageCode } from '../helpers';

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

export type GinLookupResult = { offers?: GinOffer[] };
export type GinResponse = { results?: GinLookupResult[] };

export function parseGin(
    result: GinLookupResult | undefined,
    base: string
): CardResult[] {
    return (result?.offers ?? [])
        .filter((o) => o?.name && o.url && o.quantity > 0)
        .map((o) => {
            // "Sol Ring — Commander Masters #1, Etched": the edition goes after " — ", where isExactMatch cuts
            const edition = [
                [o.setName, o.collectorNumber && `#${o.collectorNumber}`]
                    .filter(Boolean)
                    .join(' '),
                o.finish === 'etched' && 'Etched',
                o.signed && 'Signed'
            ]
                .filter(Boolean)
                .join(', ');
            return {
                shop: 'gin' as const,
                name: edition ? `${o.name} — ${edition}` : o.name,
                url: abs(base, o.url)!,
                image: abs(base, o.imageUrl ?? undefined),
                // null when unknown, never 0 (which would win best price)
                price:
                    typeof o.priceUah === 'number' && o.priceUah > 0
                        ? o.priceUah
                        : null,
                artSeries: /art series/i.test(o.setName ?? ''),
                stock: o.quantity,
                foil: o.finish ? o.finish !== 'nonfoil' : undefined,
                language: languageCode(o.language),
                // "normal" covers everything short of heavily played, so it gets no badge
                condition: o.condition === 'heavily_played' ? 'HP' : undefined
            };
        });
}
