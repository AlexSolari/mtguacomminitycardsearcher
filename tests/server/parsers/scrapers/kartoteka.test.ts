import { describe, expect, test } from 'bun:test';
import { SHOP_INFO } from '@/shops';
import { parseKartoteka } from '@/server/parsers/scrapers/kartoteka';
import { expectWellFormed, html } from '../parser-fixtures';

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

    test('malformed product JSON → []', () => {
        expect(parseKartoteka('var products = [{oops}],\n', base)).toEqual([]);
    });
});
