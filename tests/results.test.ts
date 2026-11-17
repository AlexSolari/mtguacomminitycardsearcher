import { describe, expect, test } from 'bun:test';
import {
    cheapestCopies,
    isNotFound,
    offerKey,
    sellerUah,
    splitMatches
} from '@/results';
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

    test("traders' offers are a group of their own, by USD price, and never price the card", () => {
        const trader = (usdPrice?: number) =>
            offer('Daze', null, {
                shop: 'traders',
                url: 'https://t.me/seller',
                ...(usdPrice !== undefined && { usdPrice })
            });
        const split = splitMatches(
            result('Daze', [
                trader(),
                trader(3),
                offer('Daze', 40),
                trader(1.5)
            ])
        );
        expect(split.traders.map((l) => l.usdPrice)).toEqual([
            1.5,
            3,
            undefined
        ]);
        expect(split.exact.map((l) => l.price)).toEqual([40]);
        expect(split.min).toBe(40);
        expect(split.pricing.size).toBe(1);

        // a card only traders have has no price of its own
        const only = splitMatches(result('Daze', [trader(2)]));
        expect([only.exact, only.other, only.min]).toEqual([[], [], null]);
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

test("sellerUah: a trader's USD price at their rate, to the hryvnia", () => {
    const trader = (extra: Partial<CardResult>) =>
        offer('Daze', null, { shop: 'traders', ...extra });
    expect(sellerUah(trader({ usdPrice: 2.89, usdRate: 43.5 }))).toBe(126);
    expect(sellerUah(trader({ usdPrice: 2.89 }))).toBeNull();
    expect(sellerUah(trader({ usdRate: 43.5 }))).toBeNull();
});

test('offerKey tells apart offers that share a URL', () => {
    const a = offer('Daze', 10);
    expect(offerKey(a)).not.toBe(offerKey({ ...a, price: 12 }));
    expect(offerKey(a)).not.toBe(offerKey({ ...a, condition: 'LP' }));
    expect(offerKey(a)).not.toBe(offerKey({ ...a, language: 'JA' }));
    expect(offerKey(a)).not.toBe(offerKey({ ...a, foil: true }));

    // a trader's offers all link their Telegram
    const seller = {
        name: 'Seller',
        username: 'seller',
        list: 'https://manabox.app/decks/a',
        listTitle: null,
        updatedAt: 0,
        printing: 'C21'
    };
    const t = offer('Sol Ring', null, {
        shop: 'traders',
        url: 'https://t.me/seller',
        seller
    });
    expect(offerKey(t)).not.toBe(offerKey({ ...t, name: 'Daze' }));
    expect(offerKey(t)).not.toBe(
        offerKey({ ...t, seller: { ...seller, printing: 'CMM' } })
    );
    expect(offerKey(t)).not.toBe(
        offerKey({
            ...t,
            seller: { ...seller, list: 'https://manabox.app/decks/b' }
        })
    );
});

describe('isNotFound', () => {
    test('no offers, no errors, nothing pending', () => {
        expect(isNotFound(result('Sol Ring', []))).toBe(true);
    });

    test('any offer counts as found', () => {
        expect(isNotFound(result('Sol Ring', [offer('Sol Ring', 10)]))).toBe(
            false
        );
    });

    test('a failed shop is not "not found": it gets a manual check tile', () => {
        expect(
            isNotFound({
                ...result('Sol Ring', []),
                errors: [{ shop: 'carton', message: 'timeout' }]
            })
        ).toBe(false);
    });

    test('a shop still searching is not "not found" yet', () => {
        expect(
            isNotFound({ ...result('Sol Ring', []), pending: ['carton'] })
        ).toBe(false);
    });
});
