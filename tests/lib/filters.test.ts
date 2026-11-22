import { describe, expect, test } from 'bun:test';
import {
    filterResult,
    isFiltering,
    languageCounts,
    NO_FILTERS,
    offerPasses,
    parseFilters,
    shopCounts,
    type OfferFilters
} from '@/lib/filters';
import { splitMatches } from '@/lib/results';
import type { CardResult, SearchResult } from '@/shared/search-result';

const offer = (extra: Partial<CardResult> = {}): CardResult => ({
    shop: 'carton',
    name: 'Shock',
    url: 'https://example.com/shock',
    image: null,
    price: 10,
    ...extra
});
const filters = (extra: Partial<OfferFilters>): OfferFilters => ({
    ...NO_FILTERS,
    ...extra
});

describe('offerPasses', () => {
    test('foil: "foil" keeps only foils, "nonfoil" counts a missing flag as non-foil', () => {
        const foil = offer({ foil: true });
        const regular = offer({ foil: false });
        const unsaid = offer(); // Kartoteka, PayToWin: regular cards leave `foil` out
        const onlyFoil = filters({ foil: 'foil' });
        const noFoil = filters({ foil: 'nonfoil' });
        expect(
            [foil, regular, unsaid].map((o) => offerPasses(o, onlyFoil))
        ).toEqual([true, false, false]);
        expect(
            [foil, regular, unsaid].map((o) => offerPasses(o, noFoil))
        ).toEqual([false, true, true]);
    });

    test('language: drops the hidden ones, keeps offers that give none', () => {
        const f = filters({ hiddenLanguages: ['RU'] });
        expect(offerPasses(offer({ language: 'EN' }), f)).toBe(true);
        expect(offerPasses(offer({ language: 'JA' }), f)).toBe(true);
        expect(offerPasses(offer({ language: 'RU' }), f)).toBe(false);
        // Kartoteka and traders' lists don't say
        expect(offerPasses(offer({ shop: 'kartoteka' }), f)).toBe(true);
    });

    test('shop: drops the hidden shops', () => {
        const f = filters({ hiddenShops: ['carton', 'traders'] });
        expect(offerPasses(offer(), f)).toBe(false);
        expect(offerPasses(offer({ shop: 'traders', price: null }), f)).toBe(
            false
        );
        expect(offerPasses(offer({ shop: 'gin' }), f)).toBe(true);
    });

    test('no filters pass everything', () => {
        expect(isFiltering(NO_FILTERS)).toBe(false);
        expect(
            offerPasses(offer({ foil: true, language: 'RU' }), NO_FILTERS)
        ).toBe(true);
    });
});

describe('filterResult', () => {
    const result: SearchResult = {
        card: 'Shock',
        links: [
            offer({ language: 'EN' }),
            offer({ shop: 'gin', foil: true, language: 'EN' }),
            offer({ shop: 'kartoteka', language: 'RU' })
        ],
        errors: [
            { shop: 'kartoteka', message: 'HTTP 403', status: 403 },
            { shop: 'nerdik', message: 'timeout' },
            { message: 'whole request failed' }
        ],
        pending: ['kartoteka', 'citadel']
    };

    test('without filters, the result itself', () => {
        expect(filterResult(result, NO_FILTERS)).toBe(result);
    });

    test("keeps the passing offers, and drops hidden shops' errors and pending searches", () => {
        const f = filters({ foil: 'nonfoil', hiddenShops: ['kartoteka'] });
        expect(filterResult(result, f)).toEqual({
            card: 'Shock',
            links: [result.links[0]!],
            errors: [result.errors[1]!, result.errors[2]!],
            pending: ['citadel']
        });
        expect(result.links).toHaveLength(3); // the original is left alone
    });

    test('a finished result stays without `pending`', () => {
        const { pending, ...finished } = result;
        expect(
            filterResult(finished, filters({ foil: 'foil' }))
        ).not.toHaveProperty('pending');
    });

    // CardSection is memoized on the object and splitMatches caches per object
    test('the same object while result and filters stay the same', () => {
        const a = filterResult(result, filters({ foil: 'foil' }));
        expect(filterResult(result, filters({ foil: 'foil' }))).toBe(a);
        expect(splitMatches(a).exact).toHaveLength(1);
        const b = filterResult(result, filters({ foil: 'nonfoil' }));
        expect(b).not.toBe(a);
        expect(b.links).toHaveLength(2);
    });
});

describe('counts', () => {
    const results: SearchResult[] = [
        {
            card: 'Shock',
            links: [
                offer({ language: 'RU' }),
                offer({ language: 'EN' }),
                offer({ shop: 'gin', language: 'EN' })
            ],
            errors: []
        },
        {
            card: 'Opt',
            links: [offer({ shop: 'kartoteka' }), offer({ language: 'JA' })],
            errors: []
        }
    ];

    test('languages, most offers first, then by code; offers without one left out', () => {
        expect(languageCounts(results)).toEqual([
            ['EN', 2],
            ['JA', 1],
            ['RU', 1]
        ]);
    });

    test("shops in the registry's order, those with nothing at 0", () => {
        const counts = shopCounts(results);
        expect(counts[0]).toEqual(['gin', 1]);
        expect(counts.find(([s]) => s === 'carton')).toEqual(['carton', 3]);
        expect(counts.find(([s]) => s === 'kartoteka')).toEqual([
            'kartoteka',
            1
        ]);
        expect(counts.find(([s]) => s === 'citadel')).toEqual(['citadel', 0]);
        expect(counts.map(([s]) => s)).toContain('traders');
    });
});

describe('parseFilters', () => {
    test('round-trips saved filters', () => {
        const f: OfferFilters = {
            foil: 'nonfoil',
            hiddenLanguages: ['RU'],
            hiddenShops: ['kartoteka', 'traders']
        };
        expect(parseFilters(JSON.stringify(f))).toEqual(f);
    });

    test('nothing saved, broken JSON or not an object → no filters', () => {
        for (const raw of [null, '', '{oops', 'null', '42'])
            expect(parseFilters(raw)).toEqual(NO_FILTERS);
    });

    test('drops what it doesn’t recognise', () => {
        expect(
            parseFilters(
                JSON.stringify({
                    foil: 'shiny',
                    hiddenLanguages: ['EN', 'english', 7],
                    hiddenShops: ['gin', 'amazon', 'toString', null]
                })
            )
        ).toEqual({
            foil: 'any',
            hiddenLanguages: ['EN'],
            hiddenShops: ['gin']
        });
        expect(parseFilters('{"hiddenLanguages":"EN"}')).toEqual(NO_FILTERS);
    });
});
