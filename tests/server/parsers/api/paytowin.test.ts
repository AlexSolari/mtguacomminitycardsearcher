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

    test('prices go through toPrice: 0, strings and junk are never a price', () => {
        const [bidZero, stringPrices, junkBid] = parsePaytowin({
            items: [
                { ...lot, current_high_uah: 0 },
                {
                    ...lot,
                    starting_price_uah: '250.50',
                    current_high_uah: '300',
                    buy_now_uah: '900'
                },
                { ...lot, current_high_uah: 'soon', buy_now_uah: 0 }
            ]
        });
        expect(bidZero).toMatchObject({
            price: 200,
            auction: { currentBid: null, startingPrice: 200 }
        });
        expect(stringPrices).toMatchObject({
            price: 300,
            auction: { currentBid: 300, startingPrice: 250.5, buyNow: 900 }
        });
        expect(junkBid).toMatchObject({
            price: 200,
            auction: { currentBid: null, buyNow: null }
        });
    });

    test('malformed lots are skipped, not the whole response', () => {
        const results = parsePaytowin({
            items: [
                null,
                'lot',
                { ...lot, id: undefined },
                { ...lot, id: 'free', starting_price_uah: 0 },
                { ...lot, id: 'unpriced', starting_price_uah: null },
                { ...lot, id: 'ok' }
            ]
        });
        expect(results.map((r) => r.url)).toEqual([
            'https://paytowin.club/a/ok'
        ]);
        expect(parsePaytowin({ items: 'nope' })).toEqual([]);
        expect(parsePaytowin(null)).toEqual([]);
    });

    test('odd field values fall back rather than leak through', () => {
        const [r] = parsePaytowin({
            items: [
                {
                    ...lot,
                    title: 42,
                    condition: 'constructor',
                    language: 7,
                    bid_count: -3,
                    end_time: null,
                    photos: [{ urls: { medium: 5, thumb: 'https://t' } }]
                }
            ]
        });
        expect(r).toMatchObject({
            name: '',
            image: 'https://t',
            auction: { bids: 0, endsAt: '' }
        });
        expect(r!.condition).toBeUndefined();
        expect(r!.language).toBeUndefined();
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
