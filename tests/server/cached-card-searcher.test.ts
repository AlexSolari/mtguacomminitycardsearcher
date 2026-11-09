import { describe, expect, test } from 'bun:test';
import type { CardResult } from '@/search-result';
import { CachedCardSearcher } from '@/server/cached-card-searcher';
import type { CardSearcher } from '@/server/card-searcher';

const RESULT: CardResult[] = [
    {
        shop: 'carton',
        name: 'Sol Ring',
        url: 'https://carton.cards/x',
        image: null,
        price: 50
    }
];

// A shop search that takes `ms`, can fail, and counts calls and aborts.
function fakeSearcher({ ms = 30, fail = false } = {}) {
    const stats = { calls: 0, aborts: 0 };
    const searcher: CardSearcher = {
        shop: 'carton',
        search(_card, signal) {
            stats.calls++;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () =>
                        fail ? reject(new Error('HTTP 500')) : resolve(RESULT),
                    ms
                );
                signal?.addEventListener('abort', () => {
                    stats.aborts++;
                    clearTimeout(timer);
                    reject(signal.reason);
                });
            });
        }
    };
    return { searcher, stats };
}

describe('CachedCardSearcher', () => {
    test('caches results; "Æther Vial" and "aether vial" share an entry', async () => {
        const { searcher, stats } = fakeSearcher();
        const cache = new CachedCardSearcher(searcher);
        expect(await cache.search('Æther Vial')).toBe(RESULT);
        expect(await cache.search('aether vial')).toBe(RESULT);
        expect(stats.calls).toBe(1);
    });

    test('passes the full name on, and keys on it too', async () => {
        const seen: (string | undefined)[] = [];
        const cache = new CachedCardSearcher({
            shop: 'nerdik',
            search: async (_card, _signal, fullName) => {
                seen.push(fullName);
                return RESULT;
            }
        });
        await cache.search('Bonecrusher Giant', undefined, 'Bonecrusher Giant');
        await cache.search(
            'Bonecrusher Giant',
            undefined,
            'Bonecrusher Giant // Stomp'
        );
        await cache.search(
            'bonecrusher giant',
            undefined,
            'Bonecrusher Giant // Stomp'
        );
        await cache.search('Daze');
        expect(seen).toEqual([
            'Bonecrusher Giant',
            'Bonecrusher Giant // Stomp',
            'Daze'
        ]);
    });

    test('identical searches in flight share one shop search', async () => {
        const { searcher, stats } = fakeSearcher();
        const cache = new CachedCardSearcher(searcher);
        await Promise.all([cache.search('Sol Ring'), cache.search('Sol Ring')]);
        expect(stats.calls).toBe(1);
    });

    test('entries expire after ttlMs', async () => {
        const { searcher, stats } = fakeSearcher({ ms: 1 });
        const cache = new CachedCardSearcher(searcher, 20);
        await cache.search('Sol Ring');
        await Bun.sleep(30);
        await cache.search('Sol Ring');
        expect(stats.calls).toBe(2);
    });

    test('failures are not cached', async () => {
        const { searcher, stats } = fakeSearcher({ fail: true });
        const cache = new CachedCardSearcher(searcher);
        await expect(cache.search('Sol Ring')).rejects.toThrow('HTTP 500');
        await expect(cache.search('Sol Ring')).rejects.toThrow('HTTP 500');
        expect(stats.calls).toBe(2);
    });

    test('one caller giving up leaves the shared search running for the others', async () => {
        const { searcher, stats } = fakeSearcher();
        const cache = new CachedCardSearcher(searcher);
        const leaving = new AbortController();
        const first = cache.search('Sol Ring', leaving.signal);
        const second = cache.search('Sol Ring', new AbortController().signal);
        leaving.abort();
        await expect(first).rejects.toHaveProperty('name', 'AbortError');
        expect(await second).toBe(RESULT);
        expect(stats.aborts).toBe(0);
    });

    test('the last caller giving up aborts the search, which is not cached', async () => {
        const { searcher, stats } = fakeSearcher();
        const cache = new CachedCardSearcher(searcher);
        const a = new AbortController();
        const b = new AbortController();
        const searches = [
            cache.search('Sol Ring', a.signal),
            cache.search('Sol Ring', b.signal)
        ];
        a.abort();
        b.abort();
        await Promise.allSettled(searches);
        expect(stats.aborts).toBe(1);
        expect(await cache.search('Sol Ring')).toBe(RESULT);
        expect(stats.calls).toBe(2);
    });

    test('a caller without a signal keeps the search alive', async () => {
        const { searcher, stats } = fakeSearcher();
        const cache = new CachedCardSearcher(searcher);
        const controller = new AbortController();
        const kept = cache.search('Sol Ring');
        const leaving = cache.search('Sol Ring', controller.signal);
        controller.abort();
        await expect(leaving).rejects.toHaveProperty('name', 'AbortError');
        expect(await kept).toBe(RESULT);
        expect(stats.aborts).toBe(0);
    });
});
