import { describe, expect, test } from 'bun:test';
import type { CardResult } from '@/search-result';
import {
    expandCheapest,
    MAX_PRODUCT_PAGES,
    warnFallback,
    warnIfEmpty
} from '@/server/card-searcher';
import { HttpError } from '@/server/shop-client';
import { captureLogs } from './capture-logs';

const logs = captureLogs();

describe('warnIfEmpty', () => {
    test('logs an empty parse and passes results through', () => {
        expect(
            warnIfEmpty('carton', 'https://carton.cards/search', [])
        ).toEqual([]);
        expect(logs).toMatchObject([
            {
                level: 'warn',
                message: 'parser found nothing',
                shop: 'carton',
                url: 'https://carton.cards/search'
            }
        ]);
    });
});

describe('warnFallback', () => {
    test('logs a failure', () => {
        warnFallback('gin', 'https://mtgin.kyiv.ua/x', new HttpError(429));
        expect(logs).toMatchObject([
            {
                level: 'warn',
                message: 'follow-up request failed, keeping search results',
                shop: 'gin',
                url: 'https://mtgin.kyiv.ua/x',
                error: { message: 'HTTP 429', status: 429 }
            }
        ]);
    });

    test('an expected 404 is quiet', () => {
        warnFallback('manavault', 'u', new HttpError(404), undefined, {
            expect404: true
        });
        expect(logs).toEqual([]);
    });

    test('a 404 is logged when not expected', () => {
        warnFallback('manavault', 'u', new HttpError(404));
        expect(logs).toHaveLength(1);
    });

    test('rethrows when the search was aborted, so it is not a fallback', () => {
        const err = new DOMException('aborted', 'AbortError');
        expect(() =>
            warnFallback('gin', 'u', err, AbortSignal.abort())
        ).toThrow(err);
        expect(logs).toEqual([]);
    });
});

describe('expandCheapest', () => {
    const tile = (name: string, price: number | null): CardResult => ({
        shop: 'carton',
        name,
        url: `https://carton.cards/${name}`,
        image: null,
        price,
        fromPrice: true
    });
    const offer = (t: CardResult): CardResult => ({
        ...t,
        fromPrice: undefined,
        stock: 1
    });

    test('expands only the cheapest picked tiles, keeping the order', async () => {
        const tiles = [
            tile('fuzzy', 1),
            ...Array.from({ length: MAX_PRODUCT_PAGES + 2 }, (_, i) =>
                tile(`p${i}`, i === 0 ? null : 100 - i)
            )
        ];
        const fetched: string[] = [];
        const results = await expandCheapest(
            'carton',
            tiles,
            (t) => t.name !== 'fuzzy',
            async (t) => {
                fetched.push(t.name);
                return [offer(t), offer({ ...t, price: t.price! + 1 })];
            }
        );
        // no price sorts last, then the dearest priced one: p0 and p1 stay tiles
        expect(fetched).toHaveLength(MAX_PRODUCT_PAGES);
        expect(fetched).not.toContain('p0');
        expect(fetched).not.toContain('p1');
        expect(results.map((r) => r.name)).toEqual([
            'fuzzy',
            'p0',
            'p1',
            ...tiles.slice(3).flatMap((t) => [t.name, t.name])
        ]);
        expect(logs).toEqual([]);
    });

    test('a failed or empty page keeps its tile, and is logged', async () => {
        const tiles = [tile('a', 1), tile('b', 2)];
        const results = await expandCheapest(
            'carton',
            tiles,
            () => true,
            async (t) => {
                if (t.name === 'a') throw new HttpError(500);
                return [];
            }
        );
        expect(results).toEqual(tiles);
        expect(logs.map((l) => l.message)).toEqual([
            'follow-up request failed, keeping search results',
            'parser found nothing'
        ]);
    });

    test('an aborted search rejects instead of falling back', async () => {
        const err = new DOMException('aborted', 'AbortError');
        await expect(
            expandCheapest(
                'carton',
                [tile('a', 1)],
                () => true,
                async () => {
                    throw err;
                },
                AbortSignal.abort(err)
            )
        ).rejects.toBe(err);
    });
});
