import { describe, expect, test } from 'bun:test';
import { parseNerdik } from '@/server/parsers/api/nerdik';
import { expectWellFormed, json } from '../parser-fixtures';

describe('nerdik', () => {
    test('API response: one result per in-stock offer', async () => {
        const results = parseNerdik(await json('nerdik-search.json'));
        expectWellFormed(results, 'nerdik');
        expect(results).toMatchSnapshot();
    });

    // A response without the shape the parser expects must give [], not throw and fail the whole shop.
    test('unexpected response → []', () => {
        expect(parseNerdik({})).toEqual([]);
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
