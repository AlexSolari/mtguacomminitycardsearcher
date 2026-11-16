import { beforeEach, describe, expect, test } from 'bun:test';
import { openDatabase } from '@/server/db/database';
import { PriceCache, type CardPrice } from '@/server/db/price-cache';
import { captureLogs } from '../capture-logs';

captureLogs(); // the migration's log line

const solRing: CardPrice = {
    usd: 1.5,
    usdFoil: 4,
    usdEtched: null,
    scryfallId: '00000000-0000-0000-0000-000000000001',
    image: 'https://cards.scryfall.io/normal/front/0/0/sol-ring.jpg'
};
const unpriced: CardPrice = {
    usd: null,
    usdFoil: null,
    usdEtched: null,
    scryfallId: null,
    image: null
};

describe('PriceCache', () => {
    let prices: PriceCache;
    beforeEach(() => {
        prices = new PriceCache(openDatabase(':memory:'), 1000);
    });

    test('returns the fresh prices among the keys asked for', () => {
        prices.set(
            new Map([
                ['name:sol ring', solRing],
                ['set:c21/sol ring', unpriced]
            ]),
            5000
        );
        expect(
            prices.get(
                [
                    'name:sol ring',
                    'set:c21/sol ring',
                    'name:other',
                    'name:sol ring'
                ],
                5500
            )
        ).toEqual(
            new Map([
                ['name:sol ring', solRing],
                ['set:c21/sol ring', unpriced]
            ])
        );
        expect(prices.get(['name:sol ring'], 6000)).toEqual(new Map());
    });

    test('a new price replaces the old one, and its age', () => {
        prices.set(new Map([['name:sol ring', solRing]]), 0);
        prices.set(new Map([['name:sol ring', { ...solRing, usd: 2 }]]), 5000);
        expect(
            prices.get(['name:sol ring'], 5500).get('name:sol ring')?.usd
        ).toBe(2);
    });

    test('purge drops the stale prices only', () => {
        prices.set(new Map([['name:old', solRing]]), 0);
        prices.set(new Map([['name:new', solRing]]), 900);
        expect(prices.purge(1500)).toBe(1);
        expect([...prices.get(['name:old', 'name:new'], 1500).keys()]).toEqual([
            'name:new'
        ]);
    });
});
