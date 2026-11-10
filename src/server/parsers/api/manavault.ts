import type { CardResult } from '../../../search-result';
import { languageCode } from '../helpers';

// One answer of manavaultstore.com's POST /api/v1/prices (`{"answers":[…]}`, one per name, the same as what
// GET /api/v1/prices?q=… returns) — JSON, one row per printing × finish × condition × language, in stock only,
// already close to CardResult:
//   {"query":"sol ring","match":"exact","updatedAt":"2026-11-09T10:44:27.090Z",
//    "results":[{"shop":"manavault","name":"Sol Ring","set":"NCC","setName":"New Capenna Commander","number":"379",
//      "url":"https://manavaultstore.com/cards/<scryfall id>?utm_source=price_api&utm_medium=price_api",
//      "image":"https://cards.scryfall.io/normal/front/…jpg","price":76,"fromPrice":false,"stock":1,"foil":false,
//      "language":"EN","condition":"NM","artSeries":false}, …]}
// `match` is "exact" when a card has exactly the queried name (then only it comes back), else "partial": every
// name containing the query's words, "none" when nothing matches. A name the API rejects gets `error` instead.
// `etched`, `altered` and `signed` appear only when true.
// `fromPrice` marks a row that merges offers at different prices: `price` is the cheapest, `stock` their sum.
type ManavaultRow = {
    name: string;
    setName?: string | null;
    number?: string | null;
    url: string;
    image?: string | null;
    price?: number | null; // UAH
    fromPrice?: boolean;
    stock?: number | null;
    foil?: boolean;
    language?: string | null;
    condition?: string | null; // MT, NM, EX, GD, LP, PL, PO
    artSeries?: boolean;
    etched?: boolean;
    altered?: boolean;
    signed?: boolean;
};

export type ManavaultAnswer = {
    match?: 'exact' | 'partial' | 'none';
    results?: ManavaultRow[];
    error?: string;
};

export function parseManavault(json: ManavaultAnswer): CardResult[] {
    return (json.results ?? []).flatMap((row) => {
        if (!row.name || !row.url || !(Number(row.stock) > 0)) return [];
        // "Sol Ring — New Capenna Commander #379, Etched": the edition goes after " — ", where isExactMatch cuts
        // (the same shape as the other shops' names)
        const edition = [
            [row.setName, row.number && `#${row.number}`]
                .filter(Boolean)
                .join(' '),
            row.etched && 'Etched',
            row.altered && 'Altered',
            row.signed && 'Signed'
        ]
            .filter(Boolean)
            .join(', ');
        const price =
            typeof row.price === 'number' && row.price > 0 ? row.price : null;
        return [
            {
                shop: 'manavault' as const,
                name: edition ? `${row.name} — ${edition}` : row.name,
                url: row.url,
                image: row.image || null,
                price,
                fromPrice: row.fromPrice || undefined,
                stock: Number(row.stock),
                foil: !!(row.foil || row.etched),
                language: languageCode(row.language),
                condition: row.condition || undefined,
                artSeries: row.artSeries
            }
        ];
    });
}
