import { describe, expect, test } from 'bun:test';
import { parseCitadel } from '@/server/parsers/scrapers/citadel';
import { expectWellFormed, html } from '../parser-fixtures';

describe('citadel', () => {
    const base = 'https://citadel.kyiv.ua';

    test('search page: one result per item in the Server Components data', async () => {
        const results = parseCitadel(await html('citadel-search.html'), base);
        expectWellFormed(results, 'citadel');
        for (const r of results) {
            expect(r.url).toMatch(/^https:\/\/citadel\.kyiv\.ua\/singles\//);
            expect(r.stock).toBeDefined();
        }
        expect(results).toMatchSnapshot();
    });

    // A page without the markup the parser expects is how a redesign shows up: it must give [] (logged by
    // warnIfEmpty), not throw and fail the whole shop.
    test('unexpected page → []', () => {
        expect(parseCitadel('<html></html>', base)).toEqual([]);
    });

    // The page as Next.js writes it: the payload split over several scripts, as JSON strings.
    const page = (items: unknown[]) => {
        const payload = `1c:["$","$L1c",null,{"items":${JSON.stringify(items)},"page":1,"totalPages":1}]`;
        const half = Math.floor(payload.length / 2);
        return [payload.slice(0, half), payload.slice(half)]
            .map(
                (p) =>
                    `<script>self.__next_f.push([1,${JSON.stringify(p)}])</script>`
            )
            .join('');
    };
    const item = {
        scryfall_id: 'id1',
        name: 'Fire // Ice [x]',
        set_name: 'Secrets of Strixhaven Mystical Archive',
        variant: 'showcase',
        foilType: 'etched',
        isFoil: true,
        promo: true,
        faces: [{ images: { normal: 'https://cards.scryfall.io/a.jpg' } }],
        prices: 25,
        quantity: 3,
        availableQty: 2,
        lang: 'ja',
        condition: 'lp'
    };

    test('names variants, special finishes and promos; skips sold-out and reserved items; unknown price is null', () => {
        expect(
            parseCitadel(
                page([
                    item,
                    { ...item, scryfall_id: 'id2', availableQty: 0 },
                    {
                        scryfall_id: 'id3',
                        name: 'Sol Ring',
                        set_name: 'Commander Masters Art Series',
                        variant: 'regular',
                        foilType: 'nonfoil',
                        isFoil: false,
                        prices: 0,
                        quantity: 1
                    },
                    { ...item, scryfall_id: '' },
                    null
                ]),
                base
            )
        ).toEqual([
            {
                shop: 'citadel',
                name: 'Fire // Ice [x] — Secrets of Strixhaven Mystical Archive, Showcase, Etched, Promo',
                url: 'https://citadel.kyiv.ua/singles/id1',
                image: 'https://cards.scryfall.io/a.jpg',
                price: 25,
                artSeries: false,
                stock: 2,
                foil: true,
                language: 'JA',
                condition: 'LP'
            },
            {
                shop: 'citadel',
                name: 'Sol Ring — Commander Masters Art Series',
                url: 'https://citadel.kyiv.ua/singles/id3',
                image: null,
                price: null,
                artSeries: true,
                stock: 1,
                foil: false,
                language: undefined,
                condition: undefined
            }
        ]);
    });

    test('an item without a set is named by the card alone', () => {
        expect(
            parseCitadel(
                page([{ scryfall_id: 'id1', name: 'Sol Ring', quantity: 1 }]),
                base
            ).map((r) => r.name)
        ).toEqual(['Sol Ring']);
    });

    test('broken or truncated data → []', () => {
        const items = page([item]);
        expect(
            parseCitadel(items.replace('"items\\":[', '"items\\":[}'), base)
        ).toEqual([]);
        expect(
            parseCitadel(items.slice(0, items.lastIndexOf('<script>')), base)
        ).toEqual([]);
        expect(
            parseCitadel('<script>self.__next_f.push([1,"\\x"])</script>', base)
        ).toEqual([]);
        expect(
            parseCitadel(page([]).replace('"items\\":[]', '"items\\":{}'), base)
        ).toEqual([]);
    });
});
