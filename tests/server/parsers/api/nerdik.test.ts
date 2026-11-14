import { describe, expect, test } from 'bun:test';
import { parseNerdik } from '@/server/parsers/api/nerdik';
import { expectWellFormed, json } from '../parser-fixtures';

describe('nerdik', () => {
    test('API response: one result per in-stock offer', async () => {
        const { results: lookups } = await json('nerdik-batch.json');
        const results = parseNerdik(lookups[0]);
        expectWellFormed(results, 'nerdik');
        expect(results).toMatchSnapshot();
    });

    // A result without the shape the parser expects, or missing altogether, must give [], not throw and fail the
    // whole shop.
    test('unexpected or missing result → []', () => {
        expect(parseNerdik({})).toEqual([]);
        expect(parseNerdik(undefined)).toEqual([]);
    });

    const card = {
        name: 'Sol Ring',
        game: 'mtg',
        set_name: 'Fallout',
        number: '359',
        language: 'en',
        treatment: 'foil',
        image_url: null,
        nerdik_url: 'https://nerdik.club/mtg/singles/pip/359/en/'
    };

    test('skips other games and sold-out offers; decimal prices are UAH', () => {
        expect(
            parseNerdik({
                cards: [
                    {
                        ...card,
                        offers: [
                            {
                                price_uah: '183.00',
                                available_quantity: 2,
                                nerdik_url: null
                            },
                            {
                                price_uah: '150.00',
                                available_quantity: 0,
                                nerdik_url: null
                            }
                        ]
                    },
                    {
                        ...card,
                        game: 'sorcery',
                        offers: [
                            {
                                price_uah: '1.00',
                                available_quantity: 1,
                                nerdik_url: null
                            }
                        ]
                    }
                ]
            })
        ).toEqual([
            {
                shop: 'nerdik',
                name: 'Sol Ring — Fallout #359',
                url: card.nerdik_url,
                image: null,
                price: 183,
                stock: 2,
                foil: true,
                language: 'EN'
            }
        ]);
    });

    test("a malformed printing or offer is skipped, keeping the card's other offers", () => {
        const offer = {
            price_uah: '90.00',
            available_quantity: 1,
            nerdik_url: null
        };
        const results = parseNerdik({
            cards: [
                null,
                { ...card, offers: undefined },
                { ...card, name: '', offers: [offer] },
                { ...card, nerdik_url: null, offers: [offer] }, // no link anywhere
                { ...card, offers: [null, offer] }
            ] as never
        });
        expect(results.map((r) => [r.name, r.price])).toEqual([
            ['Sol Ring — Fallout #359', 90]
        ]);
    });

    // 0 ₴ would win best price
    test('a zero or unreadable price is null, not 0', () => {
        const offer = (price_uah: string) => ({
            price_uah,
            available_quantity: 1,
            nerdik_url: null
        });
        expect(
            parseNerdik({
                cards: [{ ...card, offers: [offer('0.00'), offer('')] }]
            }).map((r) => r.price)
        ).toEqual([null, null]);
    });

    test('an unknown treatment leaves foil unknown', () => {
        const [offer] = parseNerdik({
            cards: [
                {
                    ...card,
                    set_name: null,
                    number: null,
                    language: null,
                    treatment: 'surge',
                    nerdik_url: 'https://nerdik.club/mtg/singles/x/',
                    offers: [
                        {
                            price_uah: '100.00',
                            available_quantity: 1,
                            nerdik_url: null
                        }
                    ]
                }
            ]
        });
        expect(offer).toMatchObject({ name: 'Sol Ring', foil: undefined });
    });
});
