import { describe, expect, test } from 'bun:test';
import { SHOP_INFO } from '@/shops';
import { parsePaytowin } from '@/server/parsers/api/paytowin';
import { expectWellFormed, json } from '../parser-fixtures';

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

    // A response without the shape the parser expects must give [], not throw and fail the whole shop.
    test('unexpected response → []', () => {
        expect(parsePaytowin({})).toEqual([]);
    });

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
