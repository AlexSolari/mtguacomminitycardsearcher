// Each parser against a saved page from its shop (tests/fixtures/, refreshed by scripts/update-fixtures.ts).
// The snapshots catch any change in output; the explicit checks say what must hold whatever the shop lists.
// After refreshing the fixtures, review the diff and accept it with `bun test --update-snapshots`.
import { describe, expect, test } from 'bun:test';
import type { CardResult } from '@/search-result';
import { SHOP_INFO } from '@/shops';
import { parseCarton } from '@/server/parsers/carton';
import { parseGin } from '@/server/parsers/gin';
import { parseKartoteka } from '@/server/parsers/kartoteka';
import { parseMagicswamp } from '@/server/parsers/magicswamp';
import {
    parseManavault,
    parseManavaultVersions
} from '@/server/parsers/manavault';
import { parseNerdik } from '@/server/parsers/nerdik';
import { parsePaytowin } from '@/server/parsers/paytowin';

const fixture = (name: string) =>
    Bun.file(new URL(`../../fixtures/${name}`, import.meta.url));
const html = (name: string) => fixture(name).text();
const json = (name: string) => fixture(name).json();

// What every parsed offer must look like, whichever shop it came from.
function expectWellFormed(results: CardResult[], shop: CardResult['shop']) {
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
        expect(r.shop).toBe(shop);
        expect(r.name.trim()).not.toBe('');
        expect(r.url).toMatch(/^https:\/\//);
        if (r.image !== null) expect(r.image).toMatch(/^https:\/\//);
        // null for unknown, never 0 (which would win best price)
        if (r.price !== null) expect(r.price).toBeGreaterThan(0);
        if (r.language) expect(r.language).toMatch(/^[A-Z]{2,3}$/);
        if (r.stock !== undefined) expect(r.stock).toBeGreaterThan(0);
    }
}

describe('carton', () => {
    test('search page', async () => {
        const results = parseCarton(
            await html('carton-search.html'),
            SHOP_INFO.carton.homepage
        );
        expectWellFormed(results, 'carton');
        expect(results.every((r) => r.name.startsWith('Counterspell'))).toBe(
            true
        );
        expect(results).toMatchSnapshot();
    });
});

describe('gin', () => {
    test('API response: one result per offer, edition after " — "', async () => {
        const [result] = (await json('gin-search.json')).results;
        const results = parseGin(result, SHOP_INFO.gin.homepage);
        expectWellFormed(results, 'gin');
        expect(results.every((r) => r.name.startsWith('Counterspell'))).toBe(
            true
        );
        expect(results).toMatchSnapshot();
    });
});

describe('manavault', () => {
    test('search page: one tile per card', async () => {
        const results = parseManavault(
            await html('manavault-search.html'),
            SHOP_INFO.manavault.homepage
        );
        expectWellFormed(results, 'manavault');
        expect(results).toMatchSnapshot();
    });

    test('versions page: one offer per printing', async () => {
        const results = parseManavaultVersions(
            await html('manavault-versions.html'),
            SHOP_INFO.manavault.homepage
        );
        expectWellFormed(results, 'manavault');
        expect(results.length).toBeGreaterThan(1);
        expect(results).toMatchSnapshot();
    });
});

describe('nerdik', () => {
    test('API response: one result per in-stock offer', async () => {
        const results = parseNerdik(await json('nerdik-search.json'));
        expectWellFormed(results, 'nerdik');
        expect(results).toMatchSnapshot();
    });

    test('skips other games and sold-out offers; decimal prices are UAH', () => {
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
});

describe('kartoteka', () => {
    test('search page', async () => {
        const results = parseKartoteka(
            await html('kartoteka-search.html'),
            SHOP_INFO.kartoteka.homepage
        );
        expectWellFormed(results, 'kartoteka');
        expect(results).toMatchSnapshot();
    });
});

describe('paytowin', () => {
    test('auctions: price is the current or starting bid, links go to the site', async () => {
        const results = parsePaytowin(await json('paytowin-auctions.json'));
        expectWellFormed(results, 'paytowin');
        for (const r of results) {
            expect(r.auction).toBeDefined();
            expect(r.url.startsWith(`${SHOP_INFO.paytowin.homepage}/a/`)).toBe(
                true
            );
        }
        expect(results).toMatchSnapshot();
    });
});

describe('magicswamp', () => {
    test('API response: one result per seller offer, linked to the listing', async () => {
        const results = parseMagicswamp(
            await json('magicswamp-search.json'),
            'https://magicswamp.com.ua'
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
                'https://magicswamp.com.ua'
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

// A page without the markup a parser expects is how a redesign shows up: it must give [] (logged by
// warnIfEmpty), not throw and fail the whole shop.
test.each([
    ['carton', () => parseCarton('<html></html>', SHOP_INFO.carton.homepage)],
    ['gin', () => parseGin({}, SHOP_INFO.gin.homepage)],
    ['gin, missing result', () => parseGin(undefined, SHOP_INFO.gin.homepage)],
    [
        'manavault',
        () => parseManavault('<html></html>', SHOP_INFO.manavault.homepage)
    ],
    [
        'manavault versions',
        () =>
            parseManavaultVersions(
                '<html></html>',
                SHOP_INFO.manavault.homepage
            )
    ],
    [
        'kartoteka',
        () => parseKartoteka('<html></html>', SHOP_INFO.kartoteka.homepage)
    ],
    ['nerdik', () => parseNerdik({})],
    ['paytowin', () => parsePaytowin({})],
    ['magicswamp', () => parseMagicswamp({}, 'https://magicswamp.com.ua')]
])('%s: unexpected page → []', (_, parse) => {
    expect(parse()).toEqual([]);
});
