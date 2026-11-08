import { describe, expect, test } from 'bun:test';
import { SHOP_INFO } from '@/shops';
import { parseCarton } from '@/server/parsers/scrapers/carton';
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
