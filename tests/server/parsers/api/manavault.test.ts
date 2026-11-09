import { describe, expect, test } from 'bun:test';
import { parseManavault } from '@/server/parsers/api/manavault';
import { expectWellFormed, json } from '../parser-fixtures';

describe('manavault', () => {
    test('API response: one result per printing, finish, condition and language', async () => {
        const results = parseManavault(await json('manavault-search.json'));
        expectWellFormed(results, 'manavault');
        expect(results).toMatchSnapshot();
    });

    // A response without the shape the parser expects must give [], not throw and fail the whole shop.
    test('unexpected response → []', () => {
        expect(parseManavault({})).toEqual([]);
    });

    const row = {
        name: 'Counterspell',
        setName: 'Strixhaven Mystical Archive',
        number: '15',
        url: 'https://manavaultstore.com/cards/abc?utm_source=price_api',
        image: 'https://cards.scryfall.io/normal/front/a/b/abc.jpg',
        price: 770,
        fromPrice: false,
        stock: 2,
        foil: false,
        language: 'EN',
        condition: 'NM',
        artSeries: false
    };

    test('passes the row through, with the edition after " — "', () => {
        expect(parseManavault({ match: 'exact', results: [row] })).toEqual([
            {
                shop: 'manavault',
                name: 'Counterspell — Strixhaven Mystical Archive #15',
                url: row.url,
                image: row.image,
                price: 770,
                fromPrice: undefined,
                stock: 2,
                foil: false,
                language: 'EN',
                condition: 'NM',
                artSeries: false
            }
        ]);
    });

    test('etched, altered and signed go into the edition; etched counts as foil', () => {
        const [offer] = parseManavault({
            results: [{ ...row, etched: true, signed: true, fromPrice: true }]
        });
        expect(offer).toMatchObject({
            name: 'Counterspell — Strixhaven Mystical Archive #15, Etched, Signed',
            foil: true,
            fromPrice: true
        });
    });

    test('drops sold-out rows; a missing or zero price is unknown, not 0', () => {
        const results = parseManavault({
            results: [
                { ...row, stock: 0 },
                { ...row, price: 0 },
                { ...row, price: null, setName: null, number: null, image: '' }
            ]
        });
        expect(results.map((r) => [r.name, r.price, r.image])).toEqual([
            ['Counterspell — Strixhaven Mystical Archive #15', null, row.image],
            ['Counterspell', null, null]
        ]);
    });
});
