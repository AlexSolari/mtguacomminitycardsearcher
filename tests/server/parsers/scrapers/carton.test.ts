import { describe, expect, test } from 'bun:test';
import { SHOP_INFO } from '@/shops';
import {
    parseCarton,
    parseCartonProduct
} from '@/server/parsers/scrapers/carton';
import { expectWellFormed, html } from '../parser-fixtures';

const base = SHOP_INFO.carton.homepage;

describe('carton', () => {
    test('search page', async () => {
        const results = parseCarton(await html('carton-search.html'), base);
        expectWellFormed(results, 'carton');
        expect(results.every((r) => r.name.startsWith('Counterspell'))).toBe(
            true
        );
        expect(results).toMatchSnapshot();
    });

    // A page without the markup the parser expects is how a redesign shows up: it must give [] (logged by
    // warnIfEmpty), not throw and fail the whole shop.
    test('unexpected page → []', () => {
        expect(parseCarton('<html></html>', base)).toEqual([]);
    });

    // the JSON sits HTML-escaped in <div id="app" data-page="…">
    const page = (products: object[]) =>
        `<div id="app" data-page="${JSON.stringify({ props: { products } }).replace(/"/g, '&quot;')}"></div>`;
    const product = {
        name: 'Sol Ring (C21-263)',
        url_path: '/singles/sol-ring',
        image: null,
        min_price: 50,
        language: 'English',
        property_set: { foil: 'true', nonfoil: 'false', layout: 'normal' }
    };

    test('a foil-only printing is foil; an Art Series layout is flagged', () => {
        const [foilOnly, art] = parseCarton(
            page([
                product,
                { ...product, property_set: { layout: 'art_series' } }
            ]),
            base
        );
        expect(foilOnly).toMatchObject({
            foil: true,
            artSeries: false,
            language: 'EN'
        });
        expect(art).toMatchObject({ foil: undefined, artSeries: true });
    });

    test('a missing price is null, not 0', () => {
        expect(
            parseCarton(page([{ ...product, min_price: null }]), base)[0]!.price
        ).toBeNull();
    });
});

describe('carton product page', () => {
    const url = `${base}/magic-the-gathering/singles/foundations-commander-fdc/counterspell-fdc-61-en-v1`;

    test('product page', async () => {
        const results = parseCartonProduct(
            await html('carton-product.html'),
            url
        );
        expectWellFormed(results, 'carton');
        for (const r of results) {
            expect(r.url).toBe(url);
            expect(r.stock).toBeGreaterThan(0);
            expect(r.foil).toBeBoolean();
        }
        expect(results).toMatchSnapshot();
    });

    test('unexpected page → []', () => {
        expect(parseCartonProduct('<html></html>', url)).toEqual([]);
        expect(
            parseCartonProduct('<div data-page="{not json"></div>', url)
        ).toEqual([]);
    });

    const page = (offers: object[]) =>
        `<div id="app" data-page="${JSON.stringify({
            props: {
                product: {
                    name: 'Sol Ring (C21-263)',
                    image: '/img/sol-ring.jpg',
                    property_set: { layout: 'normal' }
                },
                offers
            }
        }).replace(/"/g, '&quot;')}"></div>`;
    const offer = {
        amount: 1,
        price: 50,
        status: 'active',
        property_set: {
            version: 'non_foil',
            language: 'en',
            condition: 'near-mint'
        }
    };

    test("reads each offer's stock, finish, language and condition", () => {
        const [r] = parseCartonProduct(
            page([
                {
                    ...offer,
                    amount: 3,
                    property_set: {
                        version: 'foil',
                        language: 'ja',
                        condition: 'heavaly-played'
                    }
                }
            ]),
            url
        );
        expect(r).toEqual({
            shop: 'carton',
            name: 'Sol Ring (C21-263)',
            url,
            image: `${base}/img/sol-ring.jpg`,
            price: 50,
            artSeries: false,
            stock: 3,
            foil: true,
            language: 'JA',
            condition: 'HP'
        });
    });

    test('alike offers add up; different ones stay apart', () => {
        const results = parseCartonProduct(
            page([
                offer,
                { ...offer, amount: 2 },
                {
                    ...offer,
                    property_set: { ...offer.property_set, condition: 'played' }
                },
                { ...offer, price: 60 }
            ]),
            url
        );
        expect(results.map((r) => [r.condition, r.price, r.stock])).toEqual([
            ['NM', 50, 3],
            ['PL', 50, 1],
            ['NM', 60, 1]
        ]);
    });

    test('drops inactive and sold-out offers; a missing price is null', () => {
        const results = parseCartonProduct(
            page([
                { ...offer, status: 'sold' },
                { ...offer, amount: 0 },
                { ...offer, price: null, property_set: {} }
            ]),
            url
        );
        expect(results).toEqual([
            expect.objectContaining({
                price: null,
                stock: 1,
                foil: undefined,
                language: undefined,
                condition: undefined
            })
        ]);
    });
});
