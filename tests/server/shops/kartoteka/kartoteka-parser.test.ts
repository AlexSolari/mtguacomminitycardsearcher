import { describe, expect, test } from 'bun:test';
import { SHOP_INFO } from '@/shared/shops';
import { parseKartoteka } from '@/server/shops/kartoteka/kartoteka-parser';
import { expectWellFormed, html } from '../../parser-fixtures';

const base = SHOP_INFO.kartoteka.homepage;

describe('kartoteka', () => {
    test('search page', async () => {
        const results = parseKartoteka(
            await html('kartoteka-search.html'),
            base
        );
        expectWellFormed(results, 'kartoteka');
        expect(results).toMatchSnapshot();
    });

    // A page without the markup the parser expects is how a redesign shows up: it must give [] (logged by
    // warnIfEmpty), not throw and fail the whole shop.
    test('unexpected page → []', () => {
        expect(parseKartoteka('<html></html>', base)).toEqual([]);
    });

    const page = (products: unknown[], cards = '') =>
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
        expect(parseKartoteka(page([single], card), base)).toEqual([
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
                base
            )
        ).toEqual([]);
    });

    // 0 ₴ would win best price
    test('a missing or zero price is null, not 0', () => {
        expect(
            parseKartoteka(
                page([
                    { ...single, price: 0 },
                    { ...single, price: null }
                ]),
                base
            ).map((r) => r.price)
        ).toEqual([null, null]);
    });

    test('malformed product JSON → []', () => {
        expect(parseKartoteka('var products = [{oops}],\n', base)).toEqual([]);
    });

    test('a malformed product is skipped, not the whole page', () => {
        const results = parseKartoteka(
            page([
                null,
                'Sol Ring',
                42,
                [],
                { ...single, article: 7 },
                { ...single, title: undefined },
                { ...single, title: '   ' },
                { ...single, title: { en: 'Twin Bolt' } },
                { ...single, url: undefined },
                { ...single, url: 12 },
                { ...single, url: 'http://[' },
                { ...single, url: '/ok/' }
            ]),
            base
        );
        expect(results.map((r) => r.url)).toEqual([
            'https://kartoteka.in.ua/ok/'
        ]);
    });

    test("an image path that isn't a URL leaves the result without an image", () => {
        const card = `<div class="catalogCard j-catalog-card"><a href='/twin-bolt/'><img alt='Twin Bolt, Normal' class='catalogCard-img' src='http://['></a></div>`;
        const [r] = parseKartoteka(page([single], card), base);
        expect(r).toMatchObject({ name: 'Twin Bolt — TDM #128', image: null });
    });

    test('escaped slashes in the page’s JSON are links like any other', () => {
        const raw = `<script>var products = [{"article":"FRC-21","brand_title":"Wizards of the Coast","title":"Sol Ring","price":73,"url":"https:\\/\\/kartoteka.in.ua\\/sol-ring\\/","in_stock":true}],\n</script>`;
        expect(parseKartoteka(raw, base)[0]?.url).toBe(
            'https://kartoteka.in.ua/sol-ring/'
        );
    });
});
