import { describe, expect, test } from 'bun:test';
import { parseMagicswamp } from '@/server/parsers/api/magicswamp';
import { expectWellFormed, json } from '../parser-fixtures';

const base = 'https://magicswamp.com.ua';

describe('magicswamp', () => {
    test('API response: one result per seller offer, linked to the listing', async () => {
        const results = parseMagicswamp(
            await json('magicswamp-search.json'),
            base
        );
        expectWellFormed(results, 'magicswamp');
        for (const r of results) {
            expect(r.url).toMatch(
                /^https:\/\/magicswamp\.com\.ua\/mtg\/listing\//
            );
            expect(r.stock).toBeDefined();
        }
        expect(results).toMatchSnapshot();
    });

    // A response without the shape the parser expects is how an API change shows up: it must give [] (logged by
    // warnIfEmpty), not throw and fail the whole shop.
    test('unexpected response → []', () => {
        expect(parseMagicswamp({}, base)).toEqual([]);
    });

    test('skips other games and sold-out offers; names special finishes; unknown price is null', () => {
        const offer = {
            listing_id: 'a1',
            price: '150.00',
            currency: 'UAH',
            condition: 'light_played',
            is_foil: true,
            foil_type: 'etched',
            quantity: 2,
            language: 'ja'
        };
        const card = {
            card_name: 'Sol Ring',
            set_name: 'Commander Masters',
            card_image_url: null,
            game: 'mtg'
        };
        expect(
            parseMagicswamp(
                {
                    data: [
                        {
                            ...card,
                            sellers: [
                                offer,
                                { ...offer, listing_id: 'a2', quantity: 0 },
                                {
                                    ...offer,
                                    listing_id: 'a3',
                                    price: 10,
                                    currency: 'USD',
                                    is_foil: false,
                                    foil_type: 'none',
                                    condition: 'unknown'
                                }
                            ]
                        },
                        { ...card, game: 'pokemon', sellers: [offer] },
                        { ...card, set_name: null }
                    ]
                },
                base
            )
        ).toEqual([
            {
                shop: 'magicswamp',
                name: 'Sol Ring — Commander Masters, Etched',
                url: 'https://magicswamp.com.ua/mtg/listing/a1',
                image: null,
                price: 150,
                artSeries: false,
                stock: 2,
                foil: true,
                language: 'JA',
                condition: 'LP'
            },
            {
                shop: 'magicswamp',
                name: 'Sol Ring — Commander Masters',
                url: 'https://magicswamp.com.ua/mtg/listing/a3',
                image: null,
                price: null,
                artSeries: false,
                stock: 2,
                foil: false,
                language: 'JA',
                condition: undefined
            }
        ]);
    });
});
