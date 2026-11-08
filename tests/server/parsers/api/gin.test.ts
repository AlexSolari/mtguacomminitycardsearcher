import { describe, expect, test } from 'bun:test';
import { SHOP_INFO } from '@/shops';
import { parseGin } from '@/server/parsers/api/gin';
import { expectWellFormed, json } from '../parser-fixtures';

const base = SHOP_INFO.gin.homepage;

describe('gin', () => {
    test('API response: one result per offer, edition after " — "', async () => {
        const [result] = (await json('gin-search.json')).results;
        const results = parseGin(result, base);
        expectWellFormed(results, 'gin');
        expect(results.every((r) => r.name.startsWith('Counterspell'))).toBe(
            true
        );
        expect(results).toMatchSnapshot();
    });

    // A response without the shape the parser expects must give [], not throw and fail the whole shop.
    test('unexpected response → []', () => {
        expect(parseGin({}, base)).toEqual([]);
        expect(parseGin(undefined, base)).toEqual([]);
    });

    const offer = {
        name: 'Daze',
        setName: 'Nemesis',
        collectorNumber: '29',
        language: 'en',
        finish: 'nonfoil',
        condition: 'normal',
        signed: false,
        quantity: 2,
        priceUah: 50,
        url: '/shops/mtgin/cards/1-daze',
        imageUrl: null
    };
    const parse = (...offers: (object | null)[]) =>
        parseGin({ offers: offers as any }, base);

    test('an offer carries its edition and details', () => {
        expect(parse(offer)).toEqual([
            {
                shop: 'gin',
                name: 'Daze — Nemesis #29',
                url: 'https://mtgin.kyiv.ua/shops/mtgin/cards/1-daze',
                image: null,
                price: 50,
                artSeries: false,
                stock: 2,
                foil: false,
                language: 'EN',
                condition: undefined
            }
        ]);
    });

    test('etched and signed go into the edition; heavily played is HP', () => {
        expect(
            parse({
                ...offer,
                collectorNumber: null,
                finish: 'etched',
                signed: true,
                condition: 'heavily_played'
            })[0]
        ).toMatchObject({
            name: 'Daze — Nemesis, Etched, Signed',
            foil: true,
            condition: 'HP'
        });
    });

    test('no edition, finish or price: plain name, unknowns stay unknown', () => {
        expect(
            parse({
                ...offer,
                setName: null,
                collectorNumber: null,
                finish: null,
                priceUah: 0
            })[0]
        ).toMatchObject({ name: 'Daze', foil: undefined, price: null });
    });

    test('Art Series printings are flagged', () => {
        expect(
            parse({ ...offer, setName: 'Modern Horizons Art Series' })[0]
                ?.artSeries
        ).toBe(true);
    });

    test('sold-out and malformed offers are skipped', () => {
        expect(
            parse({ ...offer, quantity: 0 }, { ...offer, url: '' }, null)
        ).toEqual([]);
    });
});
