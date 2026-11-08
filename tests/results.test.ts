import { describe, expect, test } from 'bun:test';
import { cheapestCopies, offerKey, splitMatches } from '@/results';
import type { CardResult, SearchResult } from '@/search-result';

const offer = (
    name: string,
    price: number | null,
    extra: Partial<CardResult> = {}
): CardResult => ({
    shop: 'carton',
    name,
    url: `https://example.com/${encodeURIComponent(name)}/${price}`,
    image: null,
    price,
    ...extra
});
const result = (card: string, links: CardResult[]): SearchResult => ({
    card,
    links,
    errors: []
});

describe('splitMatches', () => {
    test('groups offers, each sorted by price with unknown prices last', () => {
        const split = splitMatches(
            result('Daze', [
                offer('Daze — Nemesis #29', 80),
                offer('School Daze', 5),
                offer('Daze', null),
                offer('Daze — Art Series', 16, { artSeries: true }),
                offer('Daze', 300, {
                    auction: {
                        currentBid: null,
                        startingPrice: 300,
                        buyNow: null,
                        endsAt: '2026-01-01T00:00:00Z',
                        bids: 0
                    }
                }),
                offer('Daze (PLST-DD2-23)', 40)
            ])
        );
        expect(split.exact.map((l) => l.price)).toEqual([40, 80, null]);
        expect(split.other.map((l) => l.name)).toEqual(['School Daze']);
        expect(split.art.map((l) => l.price)).toEqual([16]);
        expect(split.auctions.map((l) => l.price)).toEqual([300]);
    });

    test('best price comes from exact matches, never fuzzy, Art Series or auctions', () => {
        const split = splitMatches(
            result('Daze', [
                offer('School Daze', 5),
                offer('Daze — Art Series', 1, { artSeries: true }),
                offer('Daze', 40)
            ])
        );
        expect(split.min).toBe(40);
        expect([...split.pricing].map((l) => l.name)).toEqual(['Daze']);
    });

    test('without exact matches, fuzzy matches price the card, then Art Series', () => {
        expect(
            splitMatches(result('Daze', [offer('School Daze', 5)])).min
        ).toBe(5);
        expect(
            splitMatches(
                result('Daze', [
                    offer('Daze — Art Series', 16, { artSeries: true })
                ])
            ).min
        ).toBe(16);
    });

    test('is computed once per result object', () => {
        const r = result('Daze', [offer('Daze', 40)]);
        expect(splitMatches(r)).toBe(splitMatches(r));
    });
});

describe('cheapestCopies', () => {
    test('fills from the cheapest offer up, within stock', () => {
        const offers = [
            offer('a', 10, { stock: 1 }),
            offer('b', 20, { stock: 5 })
        ];
        expect(cheapestCopies(offers, 3)).toEqual({ cost: 50, copies: 3 });
    });

    test('an offer without a stock figure counts as plenty', () => {
        expect(cheapestCopies([offer('a', 10)], 4)).toEqual({
            cost: 40,
            copies: 4
        });
    });

    test('skips offers without a price', () => {
        const offers = [offer('a', null), offer('b', 30, { stock: 1 })];
        expect(cheapestCopies(offers, 1)).toEqual({ cost: 30, copies: 1 });
    });

    test('reports a shortfall', () => {
        expect(cheapestCopies([offer('a', 10, { stock: 2 })], 4)).toEqual({
            cost: 20,
            copies: 2
        });
    });
});

test('offerKey tells apart offers that share a URL', () => {
    const a = offer('Daze', 10);
    expect(offerKey(a)).not.toBe(offerKey({ ...a, price: 12 }));
});
