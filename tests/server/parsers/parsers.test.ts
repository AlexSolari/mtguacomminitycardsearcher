// Each parser against a saved page from its shop (tests/fixtures/, refreshed by scripts/update-fixtures.ts).
// The snapshots catch any change in output; the explicit checks say what must hold whatever the shop lists.
// After refreshing the fixtures, review the diff and accept it with `bun test --update-snapshots`.
import { describe, expect, test } from 'bun:test';
import type { CardResult } from '@/search-result';
import { SHOP_INFO } from '@/shops';
import { parseCarton } from '@/server/parsers/carton';
import { parseGin, parseGinPrintings } from '@/server/parsers/gin';
import { parseKartoteka } from '@/server/parsers/kartoteka';
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
    test('search page: several printings make one summary tile', async () => {
        const results = parseGin(
            await html('gin-search.html'),
            SHOP_INFO.gin.homepage
        );
        expectWellFormed(results, 'gin');
        const summary = results.find((r) => r.printings);
        expect(summary).toMatchObject({ fromPrice: true });
        expect(summary!.printings).toBeGreaterThan(1);
        expect(results).toMatchSnapshot();
    });

    test('printings page: one offer per printing and seller', async () => {
        const results = parseGinPrintings(
            await html('gin-printings.html'),
            SHOP_INFO.gin.homepage
        );
        expectWellFormed(results, 'gin');
        // "Counterspell — Fifth Edition #77": the edition goes after " — ", where isExactMatch cuts
        expect(results.every((r) => r.name.startsWith('Counterspell — '))).toBe(
            true
        );
        expect(results).toMatchSnapshot();
    });

    test('falls back to the rendered HTML when the flight data is missing', () => {
        const page = `
            <article class="card marketplaceCard" data-x="1">
                <a data-catalog-card-link="true" href="/cards/1-daze"><img src="/img/daze.jpg"></a>
                <h2><a href="/cards/1-daze">Daze</a></h2>
                <a class="catalogSetLink" href="/sets/nem">Nemesis</a>
                <div class="buy"><strong>42 ₴</strong></div>
            </article>`;
        expect(parseGin(page, SHOP_INFO.gin.homepage)).toEqual([
            {
                shop: 'gin',
                name: 'Daze',
                url: 'https://mtgin.kyiv.ua/cards/1-daze',
                image: 'https://mtgin.kyiv.ua/img/daze.jpg',
                price: 42,
                artSeries: false
            }
        ]);
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

// A page without the markup a parser expects is how a redesign shows up: it must give [] (logged by
// warnIfEmpty), not throw and fail the whole shop.
test.each([
    ['carton', () => parseCarton('<html></html>', SHOP_INFO.carton.homepage)],
    ['gin', () => parseGin('<html></html>', SHOP_INFO.gin.homepage)],
    [
        'gin printings',
        () => parseGinPrintings('<html></html>', SHOP_INFO.gin.homepage)
    ],
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
    ['paytowin', () => parsePaytowin({})]
])('%s: unexpected page → []', (_, parse) => {
    expect(parse()).toEqual([]);
});
