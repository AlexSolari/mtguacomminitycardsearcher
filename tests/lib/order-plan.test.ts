import { describe, expect, test } from 'bun:test';
import {
    planCards,
    planOptions,
    planOrder,
    shopsWithOffers,
    traderMatches,
    withoutShop,
    type PlanCard
} from '@/lib/order-plan';
import { allocateCopies, cheapestCopies } from '@/lib/results';
import type { CardResult, SearchResult } from '@/shared/search-result';
import type { ShopId } from '@/shared/shops';

const offer = (
    shop: ShopId,
    name: string,
    price: number | null,
    extra: Partial<CardResult> = {}
): CardResult => ({
    shop,
    name,
    url: `https://example.com/${shop}/${encodeURIComponent(name)}/${price}`,
    image: null,
    price,
    ...extra
});
const result = (card: string, links: CardResult[]): SearchResult => ({
    card,
    links,
    errors: []
});
const all = (...shops: ShopId[]) => new Set<ShopId>(shops);

describe('allocateCopies', () => {
    test('takes the cheapest offers first, within stock, and agrees with cheapestCopies', () => {
        const offers = [
            offer('gin', 'Opt', 10, { stock: 1 }),
            offer('carton', 'Opt', null),
            offer('citadel', 'Opt', 15)
        ];
        const { picks, ...totals } = allocateCopies(offers, 3);
        expect(totals).toEqual({ cost: 40, copies: 3 });
        expect(picks.map((p) => [p.offer.shop, p.qty])).toEqual([
            ['gin', 1],
            ['citadel', 2]
        ]);
        expect(cheapestCopies(offers, 3)).toEqual(totals);
    });
});

describe('planCards', () => {
    test("two lines that resolve to one card are one card: its stock isn't bought twice", () => {
        // an Arena export's front face and an MTGO export's full name, both corrected to the same card
        const giant = result('Bonecrusher Giant // Stomp', [
            offer('gin', 'Bonecrusher Giant // Stomp', 50, { stock: 1 }),
            offer('carton', 'Bonecrusher Giant // Stomp', 80, { stock: 1 })
        ]);
        const cards = planCards([
            { card: 'Bonecrusher Giant', count: 1, result: giant },
            { card: 'Shock', count: 1, result: result('Shock', []) },
            { card: 'Bonecrusher Giant // Stomp', count: 2, result: giant }
        ]);
        expect(cards.map((c) => [c.card, c.count])).toEqual([
            ['Bonecrusher Giant // Stomp', 3],
            ['Shock', 1]
        ]);
        const plan = planOrder(cards, all('gin', 'carton'));
        // two copies in stock, bought once each; the third is short
        expect(plan.total).toBe(130);
        expect(plan.short).toEqual([
            { card: 'Bonecrusher Giant // Stomp', copies: 2, count: 3 },
            { card: 'Shock', copies: 0, count: 1 }
        ]);
    });

    test("each card's exact matches with a price, cheapest first; auctions, traders, fuzzy matches and pending cards bring none", () => {
        const cards = planCards([
            {
                card: 'opt',
                count: 2,
                result: result('Opt', [
                    offer('gin', 'Opt', 20),
                    offer('carton', 'Opt', 10),
                    offer('kartoteka', 'Opt', null),
                    offer('carton', 'Optimus', 5),
                    offer('paytowin', 'Opt', 1, {
                        auction: {
                            currentBid: 1,
                            startingPrice: 1,
                            buyNow: null,
                            endsAt: '2030-01-01T00:00:00Z',
                            bids: 1
                        }
                    }),
                    offer('traders', 'Opt', null, { usdPrice: 0.1 })
                ])
            },
            { card: 'Shock', count: 1, result: null }
        ]);
        expect(cards.map((c) => [c.card, c.count])).toEqual([
            ['Opt', 2],
            ['Shock', 1]
        ]);
        expect(cards[0]!.offers.map((o) => o.shop)).toEqual(['carton', 'gin']);
        expect(cards[1]!.offers).toEqual([]);
    });
});

// Opt: cheapest at CartOn; Shock: cheapest at MTGin, which has one; Bolt: only Citadel has it.
const cards: PlanCard[] = [
    {
        card: 'Opt',
        count: 1,
        offers: [
            offer('carton', 'Opt', 10, { fromPrice: true }),
            offer('gin', 'Opt', 12)
        ]
    },
    {
        card: 'Shock',
        count: 2,
        offers: [
            offer('gin', 'Shock', 5, { stock: 1 }),
            offer('carton', 'Shock', 8)
        ]
    },
    { card: 'Bolt', count: 1, offers: [offer('citadel', 'Bolt', 30)] }
];

describe('planOrder', () => {
    test('buys each card at its cheapest among the allowed shops, grouped by shop, biggest order first', () => {
        const plan = planOrder(cards, all('carton', 'gin', 'citadel'));
        expect(plan).toMatchObject({
            total: 10 + 5 + 8 + 30,
            copies: 4,
            wanted: 4,
            short: []
        });
        expect(
            plan.shops.map((s) => [
                s.shop,
                s.subtotal,
                s.copies,
                s.fromPrice,
                s.lines.map((l) => `${l.qty}× ${l.card}`)
            ])
        ).toEqual([
            ['citadel', 30, 1, false, ['1× Bolt']],
            ['carton', 18, 2, true, ['1× Opt', '1× Shock']],
            ['gin', 5, 1, false, ['1× Shock']]
        ]);
    });

    test('lists what the allowed shops lack', () => {
        const plan = planOrder(cards, all('gin'));
        expect(plan.short).toEqual([
            { card: 'Shock', copies: 1, count: 2 },
            { card: 'Bolt', copies: 0, count: 1 }
        ]);
        expect(plan.copies).toBe(2);
        expect(planOrder(cards, all()).shops).toEqual([]);
    });
});

describe('planOptions', () => {
    test('the best plan per number of shops: copies first, then price', () => {
        expect(planOptions(cards, ['gin', 'carton', 'citadel'])).toEqual([
            // one shop: CartOn's 3 copies beat MTGin's 2 and Citadel's 1
            { shops: ['carton'], copies: 3, total: 26 },
            { shops: ['carton', 'citadel'], copies: 4, total: 56 },
            { shops: ['gin', 'carton', 'citadel'], copies: 4, total: 53 }
        ]);
    });

    test("a shop that saves nothing isn't a row of its own", () => {
        const dearer: PlanCard[] = [
            {
                card: 'Opt',
                count: 1,
                offers: [offer('carton', 'Opt', 10), offer('gin', 'Opt', 12)]
            }
        ];
        expect(planOptions(dearer, ['gin', 'carton'])).toEqual([
            { shops: ['carton'], copies: 1, total: 10 }
        ]);
        expect(planOptions(dearer, [])).toEqual([]);
    });
});

describe('withoutShop', () => {
    test('the extra cost of buying elsewhere, or the copies lost', () => {
        const shops: ShopId[] = ['gin', 'carton', 'citadel'];
        expect(withoutShop(cards, shops, 'gin')).toEqual({
            copies: 0,
            total: 3
        });
        expect(withoutShop(cards, shops, 'citadel')).toEqual({
            copies: 1,
            total: -30
        });
    });
});

describe('shopsWithOffers', () => {
    test('the shops that have something, in the given order', () => {
        expect(
            shopsWithOffers(cards, ['citadel', 'nerdik', 'gin', 'carton'])
        ).toEqual(['citadel', 'gin', 'carton']);
    });
});

describe('traderMatches', () => {
    const seller = (username: string) => ({
        name: username.toUpperCase(),
        username,
        list: `https://moxfield.com/decks/${username}`,
        listTitle: null,
        updatedAt: 0,
        printing: null
    });
    const traderOffer = (username: string, name: string, usd: number) =>
        offer('traders', name, null, {
            url: `https://t.me/${username}`,
            seller: seller(username),
            usdPrice: usd
        });

    test('groups traders’ offers by trader and card, the trader with the most cards first', () => {
        const matches = traderMatches([
            {
                card: 'Opt',
                count: 1,
                result: result('Opt', [
                    offer('gin', 'Opt', 10),
                    traderOffer('bob', 'Opt', 0.2),
                    traderOffer('ann', 'Opt', 0.1),
                    traderOffer('ann', 'Opt', 0.3)
                ])
            },
            { card: 'Daze', count: 1, result: null },
            {
                card: 'Shock',
                count: 1,
                result: result('Shock', [traderOffer('ann', 'Shock', 0.5)])
            }
        ]);
        expect(
            matches.map((t) => [
                t.username,
                t.name,
                t.url,
                t.cards.map((c) => [c.card, c.offers.length])
            ])
        ).toEqual([
            [
                'ann',
                'ANN',
                'https://t.me/ann',
                [
                    ['Opt', 2],
                    ['Shock', 1]
                ]
            ],
            ['bob', 'BOB', 'https://t.me/bob', [['Opt', 1]]]
        ]);
    });

    test('a card on two lines of the list lists its offers once', () => {
        const opt = result('Opt', [traderOffer('ann', 'Opt', 0.1)]);
        const matches = traderMatches([
            { card: 'opt', count: 1, result: opt },
            { card: 'Opt', count: 2, result: opt }
        ]);
        expect(matches[0]!.cards).toEqual([
            { card: 'Opt', offers: [opt.links[0]!] }
        ]);
    });

    test('ties go by username', () => {
        const matches = traderMatches([
            {
                card: 'Opt',
                count: 1,
                result: result('Opt', [
                    traderOffer('zed', 'Opt', 1),
                    traderOffer('amy', 'Opt', 2)
                ])
            }
        ]);
        expect(matches.map((t) => t.username)).toEqual(['amy', 'zed']);
    });
});
