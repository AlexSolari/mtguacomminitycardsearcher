// The batching itself is exercised through GinCardSearcher (tests/server/searchers/searchers.test.ts): aborts,
// failures and requests held in flight. These cover what's generic about it.
import { describe, expect, test } from 'bun:test';
import { Batcher, BATCH_WINDOW_MS } from '@/server/batcher';
import { HttpError } from '@/server/shop-client';

describe('Batcher', () => {
    test('items that arrive together go out as one batch, each getting its own result', async () => {
        const batches: string[][] = [];
        const batcher = new Batcher<string, string>(async (items) => {
            batches.push(items);
            return items.map((item) => item.toUpperCase());
        }, 10);
        expect(
            await Promise.all(['a', 'b', 'c'].map((i) => batcher.add(i)))
        ).toEqual(['A', 'B', 'C']);
        expect(batches).toEqual([['a', 'b', 'c']]);
    });

    test('batches hold at most maxBatch items, sent one after another', async () => {
        const batches: number[][] = [];
        let inFlight = 0;
        const batcher = new Batcher<number, number>(async (items) => {
            expect(++inFlight).toBe(1);
            batches.push(items);
            await Bun.sleep(5);
            inFlight--;
            return items;
        }, 2);
        await Promise.all([1, 2, 3, 4, 5].map((i) => batcher.add(i)));
        expect(batches).toEqual([[1, 2], [3, 4], [5]]);
    });

    test("the batch is sent with its own signal, not a caller's", async () => {
        const signals: AbortSignal[] = [];
        const batcher = new Batcher<string, string>(async (items, signal) => {
            signals.push(signal);
            return items;
        }, 10);
        const caller = new AbortController();
        await batcher.add('a', caller.signal);
        expect(signals[0]).not.toBe(caller.signal);
        expect(signals[0]!.aborted).toBe(false);
    });

    // the API rejects any request holding 'bad', as a shop does a junk name
    const rejectingBad = (status: number, batches: string[][] = []) =>
        new Batcher<string, string>(async (items) => {
            batches.push(items);
            if (items.includes('bad')) throw new HttpError(status);
            return items.map((item) => item.toUpperCase());
        }, 10);

    test("a rejected batch is split until only the bad item's request fails", async () => {
        const batches: string[][] = [];
        const batcher = rejectingBad(400, batches);
        const results = await Promise.allSettled(
            ['a', 'b', 'bad', 'c', 'd'].map((i) => batcher.add(i))
        );
        expect(
            results.map((r) => (r.status === 'fulfilled' ? r.value : 'failed'))
        ).toEqual(['A', 'B', 'failed', 'C', 'D']);
        expect(batches).toEqual([
            ['a', 'b', 'bad', 'c', 'd'],
            ['a', 'b', 'bad'],
            ['a', 'b'],
            ['bad'],
            ['c', 'd']
        ]);
    });

    test('a failure that is not about the input fails the whole batch, without retries', async () => {
        for (const status of [401, 403, 429, 500]) {
            const batches: string[][] = [];
            const batcher = rejectingBad(status, batches);
            const results = await Promise.allSettled(
                ['a', 'bad'].map((i) => batcher.add(i))
            );
            expect(results.map((r) => r.status)).toEqual([
                'rejected',
                'rejected'
            ]);
            expect(batches).toHaveLength(1);
        }
    });

    test('a rejected batch nobody waits for any more is not split', async () => {
        const batches: string[][] = [];
        let fail!: () => void;
        const batcher = new Batcher<string, string>((items) => {
            batches.push(items);
            return new Promise((_, reject) => {
                fail = () => reject(new HttpError(400));
            });
        }, 10);
        const caller = new AbortController();
        const results = ['a', 'bad'].map((i) => batcher.add(i, caller.signal));
        await Bun.sleep(BATCH_WINDOW_MS + 10); // the batch is out
        caller.abort();
        fail();
        await Promise.allSettled(results);
        await Bun.sleep(5);
        expect(batches).toEqual([['a', 'bad']]);
    });
});

describe('Batcher urgent items', () => {
    test('an urgent item goes out at once, with whatever was waiting', async () => {
        const batches: string[][] = [];
        const batcher = new Batcher<string, string>(
            async (items) => {
                batches.push(items);
                return items;
            },
            10,
            10_000
        );
        const waiting = batcher.add('a');
        const urgent = batcher.add('b', undefined, true);
        expect(await Promise.all([waiting, urgent])).toEqual(['a', 'b']);
        expect(batches).toEqual([['a', 'b']]);
    });

    test('an urgent item that arrives while a batch is out goes in the next one, right after', async () => {
        const batches: string[][] = [];
        let release!: () => void;
        const held = new Promise<void>((r) => (release = r));
        const batcher = new Batcher<string, string>(
            async (items) => {
                batches.push(items);
                if (batches.length === 1) await held;
                return items;
            },
            10,
            10_000
        );
        const first = batcher.add('a', undefined, true);
        const second = batcher.add('b', undefined, true);
        await Bun.sleep(5);
        expect(batches).toEqual([['a']]);
        release();
        expect(await Promise.all([first, second])).toEqual(['a', 'b']);
        expect(batches).toEqual([['a'], ['b']]);
    });
});
