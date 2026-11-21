import { describe, expect, test } from 'bun:test';
import {
    cheapestCopies,
    isNotFound,
    mergeSameCard,
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
        // the only offer of the card itself: nothing to beat, so no badge
        expect(split.best.size).toBe(0);
    });

    const lot = (price: number) =>
        offer('Daze', price, {
            auction: {
                currentBid: null,
                startingPrice: price,
                buyNow: null,
                endsAt: '2026-12-01T20:00:00.000Z',
                bids: 0
            }
        });

    test('the badge goes to the cheapest of two priced offers or more, ties included', () => {
        const cheap = offer('Daze', 30);
        const tie = offer('Daze — Nemesis', 30, { shop: 'gin' });
        const split = splitMatches(
            result('Daze', [offer('Daze', 50), tie, offer('Daze', null), cheap])
        );
        expect([...split.best]).toEqual([tie, cheap]);
    });

    test('a lone offer beside auctions, traders, unpriced or other groups gets no badge', () => {
        const trader = offer('Daze', null, {
            shop: 'traders',
            usdPrice: 0.5,
            seller: {
                name: 'Ann',
                username: 'ann',
                list: 'https://manabox.app/decks/a',
                listTitle: null,
                updatedAt: 0,
                printing: null
            }
        });
        const split = splitMatches(
            result('Daze', [
                offer('Daze', 40),
                lot(10),
                lot(20),
                trader,
                offer('Daze', null),
                offer('Daze — Art Series', 1, { artSeries: true }),
                offer('School Daze', 5)
            ])
        );
        expect(split.min).toBe(40);
        expect(split.best.size).toBe(0);
    });

    test('fuzzy matches compete among themselves when they price the card', () => {
        const a = offer('The Walls of Ba Sing Se', 100);
        const split = splitMatches(
            result('Ba Sing Se', [
                offer('The Walls of Ba Sing Se', 150, { shop: 'gin' }),
                a
            ])
        );
        expect([...split.best]).toEqual([a]);
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

describe('mergeSameCard', () => {
    const giant = result('Bonecrusher Giant // Stomp', []);

    test('entries whose searches found the same card are one, their counts added, at the first line', () => {
        const merged = mergeSameCard([
            { card: 'Bonecrusher Giant', count: 1, result: giant },
            { card: 'Shock', count: 4, result: result('Shock', []) },
            { card: 'bonecrusher giant // stomp', count: 2, result: giant }
        ]);
        expect(merged).toEqual([
            { card: 'Bonecrusher Giant', count: 3, result: giant },
            { card: 'Shock', count: 4, result: result('Shock', []) }
        ]);
    });

    test('before its result is in, an entry is keyed by its name as typed', () => {
        const merged = mergeSameCard([
            { card: 'Opt', count: 1, result: null },
            { card: 'OPT', count: 1, result: null },
            { card: 'Bonecrusher Giant', count: 1, result: null },
            { card: 'Bonecrusher Giant // Stomp', count: 1, result: giant }
        ]);
        expect(merged.map((e) => [e.card, e.count])).toEqual([
            ['Opt', 2],
            ['Bonecrusher Giant', 1],
            ['Bonecrusher Giant // Stomp', 1]
        ]);
    });

    test("a finished result stands in for one that's still pending", () => {
        const pending = { ...giant, pending: ['carton' as const] };
        const [merged] = mergeSameCard([
            { card: 'Bonecrusher Giant', count: 1, result: pending },
            { card: 'Bonecrusher Giant // Stomp', count: 1, result: giant }
        ]);
        expect(merged!.result).toBe(giant);
        // a lone entry is passed through as it is
        const lone = { card: 'Opt', count: 1, result: pending };
        expect(mergeSameCard([lone])[0]).toBe(lone);
    });
});
