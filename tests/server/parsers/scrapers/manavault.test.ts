import { describe, expect, test } from 'bun:test';
import { isExactMatch } from '@/matching';
import { SHOP_INFO } from '@/shops';
import {
    parseManavault,
    parseManavaultOffers
} from '@/server/parsers/scrapers/manavault';
import { expectWellFormed, html } from '../parser-fixtures';

const base = SHOP_INFO.manavault.homepage;

describe('manavault', () => {
    test('search page: one tile per card', async () => {
        const results = parseManavault(
            await html('manavault-search.html'),
            base
        );
        expectWellFormed(results, 'manavault');
        // "126 – 2 719 ₴" across printings: the cheapest one counts
        expect(results[0]).toMatchObject({ price: 126, fromPrice: true });
        expect(results).toMatchSnapshot();
    });

    test('offers view: one result per kind of offer of each printing', async () => {
        const results = parseManavaultOffers(
            await html('manavault-offers.html'),
            base
        );
        expectWellFormed(results, 'manavault');
        expect(new Set(results.map((r) => r.url)).size).toBeGreaterThan(1);
        // the searcher keeps only exact matches from this page, so a lost card name drops every offer
        for (const r of results) {
            expect(isExactMatch(r.name, 'Counterspell')).toBe(true);
            expect(r.url).toMatch(/\/cards\/[0-9a-f-]+$/);
            expect(r.image).not.toBeNull();
            expect(r.stock).toBeGreaterThan(0);
            expect(r.foil).toBeBoolean();
            expect(r.condition).toBeString();
            expect(r.language).toBeString();
        }
        expect(results).toMatchSnapshot();
    });

    // A page without the markup the parser expects is how a redesign shows up: it must give [] (logged by
    // warnIfEmpty), not throw and fail the whole shop.
    test('unexpected search page → []', () => {
        expect(parseManavault('<html></html>', base)).toEqual([]);
    });

    test('unexpected offers page → []', () => {
        expect(parseManavaultOffers('<html></html>', base)).toEqual([]);
        expect(
            parseManavaultOffers('<h1>Counterspell</h1><p>no rows</p>', base)
        ).toEqual([]);
    });
});

describe('manavault offers view', () => {
    // a row as the page renders it, the seller's part left out
    const row = (
        printing: string,
        badges: string,
        qty: number,
        price: string,
        id = 'abc'
    ) =>
        `<div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm sm:grid">` +
        `<a class="flex" href="/cards/${id}"><img src="/img/${id}-160.webp" srcSet="/img/${id}-160.webp 1x, /img/${id}-320.webp 2x" alt=""/>` +
        `<span>${printing}</span></a>` +
        `<div><a href="/users/x">x</a></div>` +
        `<span class="inline-flex flex-wrap items-center gap-1.5">${badges}</span>` +
        `<span class="text-right">${qty}<!-- --> шт.</span>` +
        `<span class="ml-auto">${price} ₴<span title="TCGplayer">−16% від ринку</span></span><form></form></div>`;
    const page = (...rows: string[]) =>
        `<h1 class="mb-5">Counterspell<!-- --> <span><img alt="{U}"/></span></h1>${rows.join('')}`;
    const mh2 = '<span><img/>Modern Horizons 2</span><span>№<!-- -->267</span>';
    const nm = '<span title="Near Mint — як із бустера">NM</span>';
    const lp = '<span title="Light Played — сліди гри">LP</span>';
    const en = '<span title="Англійська">EN</span>';
    const ja = '<span title="Японська">JA</span>';

    test('reads the printing, then condition, language and finish from the badges', () => {
        const [foil, etched] = parseManavaultOffers(
            page(
                row(
                    mh2 + '<span class="ml-2">Borderless · Showcase</span>',
                    nm + ja + '<span class="rounded">FOIL</span>',
                    2,
                    '1 326'
                ),
                row(mh2, lp + en + '<span>ETCHED</span>', 1, '500')
            ),
            base
        );
        expect(foil).toEqual({
            shop: 'manavault',
            name: 'Counterspell — Modern Horizons 2 #267, Borderless · Showcase',
            url: `${base}/cards/abc`,
            image: `${base}/img/abc-320.webp`, // the srcSet's largest
            price: 1326,
            stock: 2,
            foil: true,
            language: 'JA',
            condition: 'NM'
        });
        expect(etched).toMatchObject({
            name: 'Counterspell — Modern Horizons 2 #267, Etched',
            foil: true,
            language: 'EN',
            condition: 'LP'
        });
    });

    test("a foil-only printing's finish makes it foil without a FOIL badge", () => {
        const [r] = parseManavaultOffers(
            page(row(mh2 + '<span>Ripple Foil</span>', nm + en, 1, '85')),
            base
        );
        expect(r).toMatchObject({
            name: 'Counterspell — Modern Horizons 2 #267, Ripple Foil',
            foil: true
        });
    });

    test('alike offers of a printing add up; different ones stay apart; no stock is dropped', () => {
        const results = parseManavaultOffers(
            page(
                row(mh2, nm + en, 1, '100'),
                row(mh2, nm + en, 3, '100'),
                row(mh2, nm + en, 1, '100', 'other-printing'),
                row(mh2, lp + en, 1, '100'),
                row(mh2, nm + en, 1, '120'),
                row(mh2, nm + en, 0, '90')
            ),
            base
        );
        expect(
            results.map((r) => [r.url.slice(-3), r.condition, r.price, r.stock])
        ).toEqual([
            ['abc', 'NM', 100, 4],
            ['ing', 'NM', 100, 1],
            ['abc', 'LP', 100, 1],
            ['abc', 'NM', 120, 1]
        ]);
    });

    test('missing details: no edition, price or badges', () => {
        const [r] = parseManavaultOffers(
            page(
                `<div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm">` +
                    `<a href="/cards/abc"></a>` +
                    `<span class="inline-flex flex-wrap items-center gap-1.5"></span>` +
                    `<span>1 шт.</span><span>— ₴</span><form></form></div>`
            ),
            base
        );
        expect(r).toEqual({
            shop: 'manavault',
            name: 'Counterspell',
            url: `${base}/cards/abc`,
            image: null,
            price: null,
            stock: 1,
            foil: false,
            language: undefined,
            condition: undefined
        });
    });
});
