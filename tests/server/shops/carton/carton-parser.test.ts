import { describe, expect, test } from 'bun:test';
import { parseCarton } from '@/server/shops/carton/carton-parser';
import { expectWellFormed, json } from '../../parser-fixtures';

describe('carton', () => {
    test('API response: one result per kind of offer', async () => {
        const { data } = await json('carton-search.json');
        const results = parseCarton(data.products.nodes);
        expectWellFormed(results, 'carton');
        expect(results.every((r) => r.name.startsWith('Counterspell'))).toBe(
            true
        );
        expect(results).toMatchSnapshot();
    });

    // An answer without the shape the parser expects must give [], not throw and fail the whole shop.
    test('unexpected answer → []', () => {
        expect(parseCarton(undefined)).toEqual([]);
        expect(parseCarton({})).toEqual([]);
        expect(parseCarton([null, { name: 'No URL' }])).toEqual([]);
    });

    const attributes = (
        language: string,
        condition: string,
        version: string
    ) => [
        { key: 'language', name: 'Мова', value: language },
        { key: 'condition', name: 'Стан', value: condition },
        { key: 'version', name: 'Версія', value: version }
    ];
    const product = (offers: object[], expansion = 'Foundations (FDN)') => ({
        name: 'Opt (FDN-1)',
        url: 'https://carton.cards/magic-the-gathering/singles/foundations-fdn/opt-fdn-1-en-v1',
        imageUrl: null,
        expansion: { name: expansion, slug: 'foundations-fdn' },
        offers: { nodes: offers }
    });

    test('reads finish, language and condition from the Ukrainian labels', () => {
        const [foil, plain, unknown] = parseCarton([
            product([
                {
                    amount: 2,
                    price: 30,
                    attributes: attributes('Англійська', 'Ідеальний', 'Foil')
                },
                {
                    amount: 1,
                    price: 12,
                    attributes: attributes('Російська', 'Був у грі', 'Non-foil')
                },
                {
                    amount: 1,
                    price: 10,
                    attributes: attributes('Інша', 'Легко зіграний', '')
                }
            ])
        ]);
        expect(foil).toMatchObject({
            foil: true,
            language: 'EN',
            condition: 'M',
            stock: 2,
            price: 30,
            image: null,
            artSeries: false
        });
        expect(plain).toMatchObject({
            foil: false,
            language: 'RU',
            condition: 'PL'
        });
        // "Інша" (other), and a label not seen yet, give no badge
        expect(unknown).toMatchObject({
            foil: undefined,
            language: undefined,
            condition: undefined
        });
    });

    test('alike offers are merged, adding up their stock', () => {
        const offer = (price: number, amount = 1) => ({
            amount,
            price,
            attributes: attributes('Англійська', 'Відмінний', 'Non-foil')
        });
        const results = parseCarton([
            product([offer(20), offer(20, 2), offer(25)])
        ]);
        expect(results.map((r) => [r.price, r.stock])).toEqual([
            [20, 3],
            [25, 1]
        ]);
    });

    test('out-of-stock offers are dropped; a missing or zero price is null, not 0', () => {
        const results = parseCarton([
            product([
                { amount: 0, price: 10, attributes: [] },
                { amount: 1, price: 0 },
                { amount: 1 }
            ])
        ]);
        // 0 ₴ would win best price; the two unknown prices are alike, so they merge
        expect(results).toMatchObject([{ price: null, stock: 2 }]);
    });

    test('an Art Series set is flagged', () => {
        const [art] = parseCarton([
            product(
                [{ amount: 1, price: 5, attributes: [] }],
                'Modern Horizons 3 Art Series (AMH3)'
            )
        ]);
        expect(art).toMatchObject({ artSeries: true });
    });
});
