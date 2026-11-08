import type { CardResult } from '../../search-result';
import { abs, languageCode } from './helpers';

// citadel.kyiv.ua/singles?q=… — a Next.js app with no public JSON API. The search page is rendered on the server,
// and the props it hydrates with arrive as React Server Components data in inline scripts, each a JSON string:
//   <script>self.__next_f.push([1,"…[\"$\",\"$L1c\",null,{\"items\":[{…}],\"page\":1,\"totalPages\":1}]…"])</script>
// Joined and decoded, `items` holds one entry per printing, finish, language and condition in stock:
//   {"scryfall_id":"7a3f8bc2-…","name":"Bad Deal","set":"m21","set_name":"Core Set 2021","variant":"regular",
//    "foilType":"nonfoil","isFoil":false,"faces":[{"side":"front","images":{"normal":"https://cards.scryfall.io/…"}}],
//    "prices":15,"quantity":13,"availableQty":13,"lang":"ru","condition":"NM", …}
// The rendered tiles show only name, condition, language, stock and price, so the data is read instead.
export type CitadelItem = {
    scryfall_id: string;
    name: string;
    set_name?: string | null;
    variant?: string | null; // "regular", "showcase", "borderless"…
    foilType?: string | null; // "nonfoil", "foil", "etched"…
    isFoil?: boolean;
    promo?: boolean;
    faces?: { images?: { normal?: string } }[];
    prices?: number | null; // UAH
    quantity?: number;
    availableQty?: number; // `quantity` less what is reserved in carts
    lang?: string | null;
    condition?: string | null;
};

// The page's Server Components data, decoded and joined.
export function nextFlightData(html: string): string {
    return [
        ...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)
    ]
        .map((m) => {
            try {
                return JSON.parse(m[1]!) as string;
            } catch {
                return '';
            }
        })
        .join('');
}

// Where the JSON array or object starting at `start` ends (exclusive), or -1 if it doesn't close.
export function jsonEnd(text: string, start: number): number {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            // skip the string, escapes included, so brackets inside names don't count
            for (i++; i < text.length && text[i] !== '"'; i++)
                if (text[i] === '\\') i++;
        } else if (c === '[' || c === '{') depth++;
        else if (c === ']' || c === '}') {
            if (--depth === 0) return i + 1;
        }
    }
    return -1;
}

// The `items` array of the search results, or null when the page has none (a redesign).
export function citadelItems(html: string): CitadelItem[] | null {
    const data = nextFlightData(html);
    const key = '"items":[';
    const at = data.indexOf(key);
    if (at < 0) return null;
    const start = at + key.length - 1;
    const end = jsonEnd(data, start);
    if (end < 0) return null;
    try {
        const items = JSON.parse(data.slice(start, end));
        return Array.isArray(items) ? items : null;
    } catch {
        return null;
    }
}

const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1);

// One result per item, linked to the printing's page (/singles/<scryfall id>), which lists all its offers.
export function parseCitadel(html: string, base: string): CardResult[] {
    return (citadelItems(html) ?? [])
        .filter((it) => it?.name && it.scryfall_id)
        .flatMap((it) => {
            const stock = it.availableQty ?? it.quantity ?? 0;
            if (stock <= 0) return [];
            // "Abrade — Secrets of Strixhaven Mystical Archive, Showcase": the edition goes after " — ", where
            // isExactMatch cuts. Plain foil is the `foil` badge; special finishes (etched…) are named.
            const edition = [
                it.set_name,
                it.variant && it.variant !== 'regular'
                    ? capitalize(it.variant)
                    : null,
                it.foilType && !['nonfoil', 'foil'].includes(it.foilType)
                    ? capitalize(it.foilType)
                    : null,
                it.promo ? 'Promo' : null
            ]
                .filter(Boolean)
                .join(', ');
            const price = Number(it.prices);
            return [
                {
                    shop: 'citadel' as const,
                    name: edition ? `${it.name} — ${edition}` : it.name,
                    url: abs(base, `/singles/${it.scryfall_id}`)!,
                    image: abs(base, it.faces?.[0]?.images?.normal),
                    // null when unknown, never 0 (which would win best price)
                    price: price > 0 ? price : null,
                    artSeries: /art series/i.test(it.set_name ?? ''),
                    stock,
                    foil: it.isFoil,
                    language: languageCode(it.lang),
                    condition: it.condition?.toUpperCase() || undefined
                }
            ];
        });
}
