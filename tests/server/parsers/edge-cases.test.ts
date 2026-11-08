// Branches the saved shop pages don't happen to contain (no foil listing, no unbid auction, …), on small
// hand-made inputs in each shop's format.
import { describe, expect, test } from 'bun:test';
import { parseCarton } from '@/server/parsers/carton';
import { parseGin, parseGinPrintings } from '@/server/parsers/gin';
import { parseKartoteka } from '@/server/parsers/kartoteka';
import { parseNerdik } from '@/server/parsers/nerdik';
import { parsePaytowin } from '@/server/parsers/paytowin';
import { SHOP_INFO } from '@/shops';

describe('paytowin', () => {
    const lot = {
        id: 'lot-1',
        title: ' Sol Ring ',
        status: 'live',
        starting_price_uah: 200,
        current_high_uah: null,
        buy_now_uah: 900,
        bid_count: 0,
        end_time: '2026-12-01T20:00:00.000Z',
        condition: 'near_mint',
        foil: true,
        language: 'EN',
        photos: [{ urls: { thumb: 'https://cdn.example/thumb.webp' } }]
    };

    test('an unbid lot is priced at its starting price', () => {
        expect(parsePaytowin({ items: [lot] })).toEqual([
            {
                shop: 'paytowin',
                name: 'Sol Ring',
                url: 'https://paytowin.club/a/lot-1',
                image: 'https://cdn.example/thumb.webp',
                price: 200,
                foil: true,
                language: 'EN',
                condition: 'NM',
                auction: {
                    currentBid: null,
                    startingPrice: 200,
                    buyNow: 900,
                    endsAt: lot.end_time,
                    bids: 0
                }
            }
        ]);
    });

    test('no photo → no image; ended lots are skipped', () => {
        const results = parsePaytowin({
            items: [
                { ...lot, photos: [] },
                { ...lot, id: 'lot-2', status: 'ended' }
            ]
        });
        expect(results).toHaveLength(1);
        expect(results[0]!.image).toBeNull();
    });
});

describe('carton', () => {
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
            SHOP_INFO.carton.homepage
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
            parseCarton(
                page([{ ...product, min_price: null }]),
                SHOP_INFO.carton.homepage
            )[0]!.price
        ).toBeNull();
    });
});

describe('kartoteka', () => {
    const page = (products: object[], cards = '') =>
        `<script>var products = ${JSON.stringify(products)},\n</script>${cards}`;
    const single = {
        article: 'TDM-128f',
        brand_title: 'Wizards of the Coast',
        title: 'Twin Bolt',
        price: 13,
        url: '/twin-bolt/',
        in_stock: true
    };

    test('a single: foil from the "f" article suffix, treatments from the image alt', () => {
        const card = `<div class="catalogCard j-catalog-card"><a href='/twin-bolt/'><img alt='Twin Bolt, Showcase, Regular Foil' class='catalogCard-img' src='/img/twin.jpg'></a></div>`;
        expect(
            parseKartoteka(page([single], card), SHOP_INFO.kartoteka.homepage)
        ).toEqual([
            {
                shop: 'kartoteka',
                name: 'Twin Bolt — TDM #128, Showcase',
                url: 'https://kartoteka.in.ua/twin-bolt/',
                image: 'https://kartoteka.in.ua/img/twin.jpg',
                price: 13,
                foil: true
            }
        ]);
    });

    test('skips out-of-stock items, other brands and sealed products', () => {
        expect(
            parseKartoteka(
                page([
                    { ...single, in_stock: false },
                    { ...single, brand_title: 'Hasbro' },
                    { ...single, article: 'TDM-BOOSTER-BOX' }
                ]),
                SHOP_INFO.kartoteka.homepage
            )
        ).toEqual([]);
    });

    test('malformed product JSON → []', () => {
        expect(
            parseKartoteka(
                'var products = [{oops}],\n',
                SHOP_INFO.kartoteka.homepage
            )
        ).toEqual([]);
    });
});

describe('gin', () => {
    // Next.js flight data: the page pushes JSON-string chunks whose concatenation holds the grid's props
    const flight = (items: object[]) =>
        `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify({ items }))}])</script>`;

    test('a single-printing tile carries its edition and per-printing details', () => {
        expect(
            parseGin(
                flight([
                    {
                        href: '/cards/1-daze',
                        name: 'Daze',
                        image: '/img/daze.jpg',
                        printings: 1,
                        copies: 2,
                        price: 50,
                        language: 'en',
                        finish: 'foil',
                        set_name: 'Nemesis',
                        collector_number: '29'
                    }
                ]),
                SHOP_INFO.gin.homepage
            )
        ).toEqual([
            {
                shop: 'gin',
                name: 'Daze — Nemesis #29',
                url: 'https://mtgin.kyiv.ua/cards/1-daze',
                image: 'https://mtgin.kyiv.ua/img/daze.jpg',
                price: 50,
                artSeries: false,
                fromPrice: undefined,
                printings: undefined,
                stock: 2,
                foil: true,
                language: 'EN'
            }
        ]);
    });

    test('a printing without a finish line leaves foil unknown', () => {
        const page = `<article class="marketplacePrinting"><h2>Nemesis</h2><img alt="Daze" src="/img/daze.jpg"><a href="/shops/mtgin/cards/1-daze">MTGin</a><strong>50 ₴</strong></article>`;
        const [offer] = parseGinPrintings(page, SHOP_INFO.gin.homepage);
        expect(offer).toMatchObject({
            name: 'Daze — Nemesis',
            price: 50,
            foil: undefined
        });
    });
});

test('nerdik: an unknown treatment leaves foil unknown', () => {
    const [offer] = parseNerdik({
        cards: [
            {
                name: 'Sol Ring',
                game: 'mtg',
                set_name: null,
                number: null,
                language: null,
                treatment: 'surge',
                image_url: null,
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
