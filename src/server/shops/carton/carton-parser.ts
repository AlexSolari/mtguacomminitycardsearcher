import {
    isArtSeriesSet,
    languageCode,
    toPrice
} from '@/server/shops/parse-helpers';
import type { CardResult } from '@/shared/search-result';

export type CartonOffer = {
    amount?: number;
    price?: number;
    attributes?: { key?: string; value?: string }[];
};

export type CartonProduct = {
    name?: string;
    url?: string;
    imageUrl?: string | null;
    expansion?: { name?: string; slug?: string };
    offers?: { nodes?: (CartonOffer | null)[] };
};

// CartOn's offer attributes carry Ukrainian labels. Conditions, as the product pages name them:
// mint, near-mint, excellent, good, played. Labels for lightly or heavily played haven't been seen yet; an unknown
// label just gets no badge.
const CONDITIONS: Record<string, string> = {
    Ідеальний: 'M',
    'Майже ідеальний': 'NM',
    Відмінний: 'EX',
    Добрий: 'GD',
    'Був у грі': 'PL'
};

const FINISHES: Record<string, boolean> = { Foil: true, 'Non-foil': false };

// CartOn's GraphQL API (POST /graphql), `products(search: …) { nodes { … } }`: one product per printing in stock,
// with its offers:
//   {"name":"Sol Ring (SOC-427)","url":"https://carton.cards/magic-the-gathering/singles/…/sol-ring-soc-427-en-v1",
//    "imageUrl":"https://storage.carton.cards/…","expansion":{"name":"Secrets of Strixhaven Commander (SOC)",…},
//    "offers":{"nodes":[{"amount":1,"price":666,"attributes":[{"key":"language","value":"Англійська"},
//      {"key":"condition","value":"Ідеальний"},{"key":"version","value":"Foil"}]}]}}
// Offers alike in finish, language, condition and price become one result with their stock added up, so no two
// results share both the product's URL and a price for the same kind of copy.
export function parseCarton(products: unknown): CardResult[] {
    if (!Array.isArray(products)) return [];
    return products.flatMap((p: CartonProduct | null) => {
        if (!p?.name || !p.url) return [];
        const merged = new Map<string, CardResult>();
        for (const o of p.offers?.nodes ?? []) {
            const amount = Number(o?.amount);
            if (!(amount > 0)) continue;
            const attr = (key: string) =>
                o!.attributes?.find((a) => a?.key === key)?.value ?? '';
            const result: CardResult = {
                shop: 'carton',
                name: p.name,
                url: p.url,
                image: p.imageUrl || null,
                price: toPrice(o!.price),
                artSeries: isArtSeriesSet(p.expansion?.name),
                stock: amount,
                foil: FINISHES[attr('version')],
                // "Інша" (other) has no code
                language: languageCode(attr('language')),
                condition: CONDITIONS[attr('condition')]
            };
            const key = [
                result.foil,
                result.language,
                result.condition,
                result.price
            ].join('|');
            const same = merged.get(key);
            if (same) same.stock! += amount;
            else merged.set(key, result);
        }
        return [...merged.values()];
    });
}
